"""Build and deploy Lowtide to AWS in one command (no Docker, no AWS CLI, no SAM).

  python infra/deploy.py --dry-run                 # build, package, validate the template; no AWS calls
  python infra/deploy.py [--stack lowtide-web] [--region ap-southeast-2] [--adapter layer|bridge]
                         [--site-url URL] [--countertop-url URL] [--concurrency N] [--alarm-email ADDRESS]
                         [--no-observability] [--skip-build]

Credentials come from the standard boto3 chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN,
or AWS_PROFILE). Nothing here reads a key file. Everything is created in ap-southeast-2.

Steps:
  1. build the Next.js app as a standalone server (NEXT_OUTPUT=standalone), with the public site URL baked in
  2. package it for Lambda (Linux, arm64; pure JavaScript, no native modules): server, traced node_modules,
     static assets, the Web Adapter entry (run.sh) and the fallback streaming bridge (bridge.mjs)
  3. upload the zip to a deploy bucket and create or update the CloudFormation stack (template.yaml)
  4. upload /_next/static to the stack's bucket (CloudFront serves it from S3), invalidate CloudFront
  5. on the first deploy the CloudFront address only exists after step 3, so the app is rebuilt with it and
     updated once more; later deploys read it from the stack
  6. smoke-test /api/health and the MCP endpoint through CloudFront, check /events is closed to the
     public, and print every URL
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

# Windows consoles default to a legacy code page, and the smoke test prints arrows and other non-ASCII text:
# without this, a failed print looked like a failed health check and the script retried for minutes.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent
WEB = ROOT / "web"
BUILD = ROOT / "build"
REGION = "ap-southeast-2"
PLACEHOLDER_SITE = "https://lowtide.invalid"
ZIP_LIMIT = 250e6  # Lambda's unzipped package limit (bytes)


def sh(*cmd, cwd=None, env=None):
    print("$", " ".join(map(str, cmd)), flush=True)
    subprocess.run(list(map(str, cmd)), cwd=cwd, env=env, check=True)


# ───────────────────────── build and package ─────────────────────────

def build_web(site_url: str, countertop_url: str | None):
    env = {**os.environ, "NEXT_OUTPUT": "standalone", "NEXT_PUBLIC_SITE_URL": site_url, "NEXT_TELEMETRY_DISABLED": "1"}
    if countertop_url:
        env["NEXT_PUBLIC_COUNTERTOP_URL"] = countertop_url
    env.pop("AWS_CANONICAL_URL", None)  # that one is for the Vercel build only
    npm = "npm.cmd" if os.name == "nt" else "npm"
    sh(npm, "run", "build", cwd=WEB, env=env)
    if not (WEB / ".next" / "standalone" / "server.js").exists():
        raise SystemExit("next build did not produce .next/standalone/server.js (is NEXT_OUTPUT=standalone honoured?)")


def _fix_windows_paths(app: Path):
    """A standalone build made on Windows writes the cache handler as "..\\cache-handler.cjs"; Linux needs "/"."""
    for f in (app / "server.js", app / ".next" / "required-server-files.json"):
        if f.exists():
            text = f.read_text(encoding="utf8")
            fixed = re.sub(r'("cacheHandler"\s*:\s*")([^"]*)(")', lambda m: m.group(1) + m.group(2).replace("\\\\", "/") + m.group(3), text)
            if fixed != text:
                f.write_text(fixed, encoding="utf8", newline="\n")


def package() -> tuple[Path, dict]:
    std = WEB / ".next" / "standalone"
    if not (std / "server.js").exists():
        raise SystemExit("no standalone build: run without --skip-build first")
    app = BUILD / "lambda"
    if app.exists():
        shutil.rmtree(app)
    shutil.copytree(std, app, ignore=shutil.ignore_patterns(".data", ".env*", "*.map"))
    # what CloudFront also serves from S3; kept in the function too, so a stale edge never 404s a chunk
    shutil.copytree(WEB / ".next" / "static", app / ".next" / "static")
    if (WEB / "public").exists():
        shutil.copytree(WEB / "public", app / "public", dirs_exist_ok=True)
    _fix_windows_paths(app)
    # native modules can't come from a Windows build; there should be none (images are served unoptimised)
    for junk in ("sharp", "@img"):
        for d in app.glob(f"node_modules/{junk}"):
            shutil.rmtree(d, ignore_errors=True)
    native = [p for p in app.rglob("*.node")]
    if native:
        raise SystemExit("native modules in the package (build in WSL/Linux instead): " + ", ".join(str(p.relative_to(app)) for p in native[:5]))
    for name in ("run.sh", "bridge.mjs"):
        data = (INFRA / "lambda" / name).read_bytes().replace(b"\r\n", b"\n")
        (app / name).write_bytes(data)

    out = BUILD / "lowtide-lambda.zip"
    files = sorted(p for p in app.rglob("*") if p.is_file())
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for f in files:
            rel = f.relative_to(app).as_posix()
            info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3  # unix, so Lambda keeps the mode bits
            mode = 0o755 if rel in ("run.sh",) else 0o644
            info.external_attr = (0o100000 | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, f.read_bytes())
    unzipped = sum(f.stat().st_size for f in files)
    stats = {"zip_mb": round(out.stat().st_size / 1e6, 2), "unzipped_mb": round(unzipped / 1e6, 2), "files": len(files)}
    print(f"lambda package: {stats['zip_mb']} MB zipped, {stats['unzipped_mb']} MB unzipped, {stats['files']} files (limit 250 MB unzipped)")
    if unzipped > ZIP_LIMIT:
        raise SystemExit("package too large for Lambda")
    for must in ("server.js", "run.sh", "bridge.mjs", "cache-handler.cjs", ".next/BUILD_ID"):
        if not (app / must).exists():
            raise SystemExit(f"package is missing {must}")
    return out, stats


def static_files() -> list[tuple[Path, str, str, str]]:
    """(file, key, content type, cache control) for everything under /_next/static."""
    root = WEB / ".next" / "static"
    out = []
    for f in sorted(root.rglob("*")):
        if not f.is_file() or f.suffix == ".map":
            continue
        key = "site/_next/static/" + f.relative_to(root).as_posix()
        out.append((f, key, content_type(f), "public, max-age=31536000, immutable"))
    return out


def content_type(f: Path) -> str:
    special = {".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
               ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain; charset=utf-8"}
    return special.get(f.suffix) or mimetypes.guess_type(f.name)[0] or "application/octet-stream"


# ───────────────────────── template checks (no AWS) ─────────────────────────

def load_template() -> dict:
    try:
        import yaml
    except ImportError:
        print("PyYAML isn't installed: skipping the offline template check (CloudFormation still validates it)")
        return None

    class Loader(yaml.SafeLoader):
        pass

    def tag(name):
        def construct(loader, node):
            if isinstance(node, yaml.ScalarNode):
                value = loader.construct_scalar(node)
            elif isinstance(node, yaml.SequenceNode):
                value = loader.construct_sequence(node, deep=True)
            else:
                value = loader.construct_mapping(node, deep=True)
            return {name: value}
        return construct

    for t in ("Ref", "Sub", "GetAtt", "If", "Not", "Equals", "Select", "Split", "Join", "Condition", "GetAZs", "And", "Or"):
        Loader.add_constructor(f"!{t}", tag("Ref" if t == "Ref" else f"Fn::{t}" if t != "Condition" else "Condition"))
    return yaml.load((INFRA / "template.yaml").read_text(encoding="utf8"), Loader=Loader)


def check_template(t: dict):
    resources, params, conds = t["Resources"], t.get("Parameters", {}), t.get("Conditions", {})
    pseudo = {"AWS::Region", "AWS::AccountId", "AWS::StackName", "AWS::NoValue", "AWS::Partition", "AWS::URLSuffix"}
    problems = []

    def walk(node):
        if isinstance(node, dict):
            for k, v in node.items():
                if k == "Ref" and isinstance(v, str) and v not in resources and v not in params and v not in pseudo:
                    problems.append(f"Ref to unknown {v}")
                if k == "Fn::GetAtt":
                    target = (v.split(".")[0] if isinstance(v, str) else v[0])
                    if target not in resources:
                        problems.append(f"GetAtt on unknown {target}")
                if k == "Fn::Sub":
                    text = v if isinstance(v, str) else v[0]
                    for ref in re.findall(r"\$\{([^}!]+)\}", text):
                        base = ref.split(".")[0]
                        if base not in resources and base not in params and ref not in pseudo:
                            problems.append(f"Sub refers to unknown {ref}")
                if k == "Fn::If" and v[0] not in conds:
                    problems.append(f"If on unknown condition {v[0]}")
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(resources)
    walk(t.get("Outputs", {}))
    for name, r in resources.items():
        if "Condition" in r and r["Condition"] not in conds:
            problems.append(f"{name}: unknown condition {r['Condition']}")
    # the dashboard body must be valid JSON once substituted
    body = resources["Dashboard"]["Properties"]["DashboardBody"]["Fn::Sub"]
    sample = re.sub(r"\$\{[^}]+\}", "x", body)
    json.loads(sample)
    size = len((INFRA / "template.yaml").read_bytes())
    if size > 51200:
        problems.append(f"template is {size} bytes; inline templates must be under 51,200")
    if problems:
        raise SystemExit("template problems:\n  " + "\n  ".join(problems))
    print(f"template ok: {len(resources)} resources, {size} bytes, dashboard JSON parses")


# ───────────────────────── AWS ─────────────────────────

def ensure_bucket(s3, name: str, region: str):
    from botocore.exceptions import ClientError
    try:
        s3.head_bucket(Bucket=name)
    except ClientError:
        s3.create_bucket(Bucket=name, CreateBucketConfiguration={"LocationConstraint": region})
        s3.put_public_access_block(Bucket=name, PublicAccessBlockConfiguration={k: True for k in ("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")})


def stack_outputs(cf, stack: str) -> dict | None:
    from botocore.exceptions import ClientError
    try:
        s = cf.describe_stacks(StackName=stack)["Stacks"][0]
    except ClientError:
        return None
    if s["StackStatus"] in ("ROLLBACK_COMPLETE", "DELETE_COMPLETE"):
        return None
    return {o["OutputKey"]: o["OutputValue"] for o in s.get("Outputs", [])}


def deploy_stack(cf, stack: str, params: dict) -> bool:
    """Creates or updates the stack and waits. Returns True if it was created now."""
    from botocore.exceptions import ClientError
    body = (INFRA / "template.yaml").read_text(encoding="utf8")
    p = [{"ParameterKey": k, "ParameterValue": str(v)} for k, v in params.items()]
    try:
        s = cf.describe_stacks(StackName=stack)["Stacks"][0]
        if s["StackStatus"] == "ROLLBACK_COMPLETE":
            print(f"{stack} is in ROLLBACK_COMPLETE (a failed first create): deleting it before creating again")
            cf.delete_stack(StackName=stack)
            cf.get_waiter("stack_delete_complete").wait(StackName=stack)
            exists = False
        else:
            exists = True
    except ClientError:
        exists = False
    try:
        if exists:
            cf.update_stack(StackName=stack, TemplateBody=body, Parameters=p, Capabilities=["CAPABILITY_IAM"])
            waiter = cf.get_waiter("stack_update_complete")
        else:
            cf.create_stack(StackName=stack, TemplateBody=body, Parameters=p, Capabilities=["CAPABILITY_IAM"], OnFailure="ROLLBACK", Tags=[{"Key": "project", "Value": "lowtide"}])
            waiter = cf.get_waiter("stack_create_complete")
    except ClientError as e:
        if "No updates are to be performed" in str(e):
            print("stack unchanged")
            return False
        raise
    print(f"waiting for {stack} (CloudFront takes 5-15 minutes on the first deploy)…", flush=True)
    try:
        waiter.wait(StackName=stack, WaiterConfig={"Delay": 15, "MaxAttempts": 160})
    except Exception:
        # print the first failure so the cause is obvious (SCP, permission, quota)
        for ev in cf.describe_stack_events(StackName=stack)["StackEvents"][:40]:
            if "FAILED" in ev["ResourceStatus"]:
                print(f"  {ev['LogicalResourceId']}: {ev['ResourceStatus']} {ev.get('ResourceStatusReason', '')}")
        raise
    return not exists


def upload_static(s3, bucket: str):
    files = static_files()
    for f, key, ctype, cache in files:
        s3.upload_file(str(f), bucket, key, ExtraArgs={"ContentType": ctype, "CacheControl": cache})
    print(f"uploaded {len(files)} static files to s3://{bucket}/site/_next/static/")


def upload_code(s3, bucket: str, zip_path: Path) -> str:
    digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()[:16]
    key = f"lambda/lowtide-{digest}.zip"
    s3.upload_file(str(zip_path), bucket, key)
    print(f"uploaded s3://{bucket}/{key}")
    return key


def smoke(site: str):
    """Plain HTTPS checks through CloudFront (no AWS API)."""
    def get(path, **kw):
        req = urllib.request.Request(site + path, **kw)
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf8", "replace")

    for attempt in range(12):
        try:
            status, body = get("/api/health")
            print(f"GET /api/health → {status} {body[:200]}")
            break
        except Exception as e:  # CloudFront can take a minute to reach every edge
            print(f"GET /api/health not yet ({e}); retrying")
            time.sleep(10)
    init = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "deploy-smoke", "version": "1"}}}).encode()
    try:
        status, body = get("/api/mcp", data=init, method="POST", headers={"content-type": "application/json", "accept": "application/json, text/event-stream"})
        print(f"POST /api/mcp initialize → {status} {body[:160]!r}")
    except Exception as e:
        print(f"POST /api/mcp failed: {e}")
    try:
        status, body = get("/")
        print(f"GET / → {status}, {len(body)} bytes")
    except Exception as e:
        print(f"GET / failed: {e}")
    # the scheduler's pass-through route must not be reachable from outside
    try:
        status, _ = get("/events", data=b'{"source":"lowtide.schedule","job":"tonight"}', method="POST", headers={"content-type": "application/json"})
        print(f"POST /events → {status} (expected 403 or 404: the route is meant for the scheduler only)")
    except urllib.error.HTTPError as e:
        print(f"POST /events → {e.code} (closed to the public, as intended)")
    except Exception as e:
        print(f"POST /events check failed: {e}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stack", default="lowtide-web")
    ap.add_argument("--region", default=REGION)
    ap.add_argument("--dry-run", action="store_true", help="build, package and validate; no AWS calls")
    ap.add_argument("--skip-build", action="store_true", help="package the existing .next build")
    ap.add_argument("--adapter", choices=["layer", "bridge"], default="layer")
    ap.add_argument("--site-url", help="public URL baked into the build (default: the stack's CloudFront URL)")
    ap.add_argument("--countertop-url", help="Countertop's URL for links (default: the countertop-web stack's, else Vercel)")
    ap.add_argument("--homes-bucket", default="lowtide-homes-0415")
    ap.add_argument("--concurrency", type=int, default=5, help="reserved concurrency; 0 = none")
    ap.add_argument("--alarm-email", default="")
    ap.add_argument("--no-observability", action="store_true", help="skip metric filters and the dashboard")
    a = ap.parse_args()
    if a.region != REGION:
        raise SystemExit(f"the organisation allows only {REGION}")

    t = load_template()
    if t:
        check_template(t)

    if a.dry_run:
        site = a.site_url or PLACEHOLDER_SITE
        if not a.skip_build:
            build_web(site, a.countertop_url)
        zip_path, stats = package()
        print(json.dumps({"dry_run": True, "zip": str(zip_path), **stats, "static_files": len(static_files()), "site_url": site}, indent=1))
        return

    import boto3

    sess = boto3.Session(region_name=a.region)
    account = sess.client("sts").get_caller_identity()["Account"]
    s3, cf = sess.client("s3"), sess.client("cloudformation")
    existing = stack_outputs(cf, a.stack)
    site = a.site_url or (existing or {}).get("SiteUrl")
    countertop = a.countertop_url or (stack_outputs(cf, "countertop-web") or {}).get("SiteUrl")
    code_bucket = f"{a.stack}-deploy-{account}-{a.region}"
    ensure_bucket(s3, code_bucket, a.region)

    def params(code_key):
        return {"CodeBucket": code_bucket, "CodeKey": code_key, "HomesBucket": a.homes_bucket, "Adapter": a.adapter,
                "MaxConcurrency": a.concurrency, "AlarmEmail": a.alarm_email, "Observability": "false" if a.no_observability else "true"}

    for round_ in (1, 2):
        if not a.skip_build or round_ == 2:
            build_web(site or PLACEHOLDER_SITE, countertop)
        zip_path, _ = package()
        key = upload_code(s3, code_bucket, zip_path)
        if existing:
            upload_static(s3, existing["Bucket"])  # new hashed files first, so old pages keep working
        deploy_stack(cf, a.stack, params(key))
        out = stack_outputs(cf, a.stack)
        upload_static(s3, out["Bucket"])
        if a.site_url or site == out["SiteUrl"]:
            break
        site, existing = out["SiteUrl"], out
        print(f"rebuilding with the CloudFront address {site}")

    sess.client("cloudfront").create_invalidation(
        DistributionId=out["DistributionId"],
        InvalidationBatch={"Paths": {"Quantity": 1, "Items": ["/*"]}, "CallerReference": str(time.time())},
    )
    print(json.dumps(out, indent=1))
    smoke(out["SiteUrl"])
    print("\nlive at", out["SiteUrl"], "· MCP", out["McpUrl"])


if __name__ == "__main__":
    sys.exit(main())
