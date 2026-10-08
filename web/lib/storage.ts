import { createHash, createHmac, createSign } from "node:crypto";

/**
 * Where households and the daily counter live: one small key-value interface over Amazon S3, Google Cloud
 * Storage or Vercel Blob (BLOB_READ_WRITE_TOKEN), whichever is configured. Lowtide is an Amazon build, so S3 it
 * is: S3_BUCKET + S3_REGION + AWS_ROLE_ARN, keyless. The function's Vercel OIDC token is exchanged at the regional
 * STS endpoint (AssumeRoleWithWebIdentity) for temporary credentials on a role only this project's functions can
 * assume, and every request is SigV4-signed. Conditional writes use S3's If-Match on the ETag.
 *
 * The GCS and Blob backends stay for anyone running it elsewhere. Every read returns a
 * version tag (the GCS generation, or the Blob ETag with its weak marker stripped) and every write may demand
 * it, so two instances can't overwrite each other's update. With neither configured, store.ts keeps tours as
 * files and the counters stay in memory.
 *
 * GCS needs GCS_BUCKET and one of two credentials, keyless first: GCS_WIF_AUDIENCE, the workload identity
 * provider that trusts Vercel's OIDC issuer (the function's own VERCEL_OIDC_TOKEN is exchanged at Google's STS
 * for an access token, so no key exists anywhere); or GCS_SA_KEY, a base64 service-account JSON, where keys
 * are allowed. Routed moved from Blob to GCS on Oct 8 2026: a Hobby account's monthly Blob allowance is shared
 * by every project on it, and when it ran out the store was suspended and every saved tour vanished at once.
 */
export type Stored = { text: string; etag?: string };

export type Storage = {
  read(key: string): Promise<Stored | null>;
  /** Writes `text`; with `ifMatch`, only if the stored version still has that tag (throws otherwise). */
  write(key: string, text: string, opts?: { ifMatch?: string; contentType?: string }): Promise<void>;
  /** Keys under a prefix. */
  list(prefix: string, limit?: number): Promise<string[]>;
};

/* ───────────────────────── Google Cloud Storage ───────────────────────── */

type ServiceAccount = { client_email: string; private_key: string };

let token: { value: string; exp: number } | null = null;

function account(): ServiceAccount {
  const raw = process.env.GCS_SA_KEY!;
  const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(json) as ServiceAccount;
}

/** The function's Vercel OIDC token: the env var at invocation, or the SDK's refreshed one when it is installed. */
async function vercelOidcToken(): Promise<string> {
  try {
    const mod = (await import("@vercel/oidc").catch(() => null)) as { getVercelOidcToken?: () => Promise<string> } | null;
    if (mod?.getVercelOidcToken) return await mod.getVercelOidcToken();
  } catch {
    /* fall through to the env var */
  }
  const t = process.env.VERCEL_OIDC_TOKEN;
  if (!t) throw new Error("VERCEL_OIDC_TOKEN is not set (enable OIDC federation on the Vercel project)");
  return t;
}

/** Exchanges the Vercel OIDC token at Google's STS for an access token on the bucket (workload identity). */
async function federatedToken(audience: string): Promise<{ value: string; exp: number }> {
  const r = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience,
      scope: "https://www.googleapis.com/auth/devstorage.read_write",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      subjectToken: await vercelOidcToken(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`GCS federation: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  return { value: j.access_token, exp: Math.floor(Date.now() / 1000) + j.expires_in };
}

/** An OAuth access token: by federation when GCS_WIF_AUDIENCE is set, else from a signed service-account JWT
 *  (RS256); cached until a few minutes before it expires. */
async function accessToken(): Promise<string> {
  if (token && token.exp - 300 > Date.now() / 1000) return token.value;
  if (process.env.GCS_WIF_AUDIENCE) {
    token = await federatedToken(process.env.GCS_WIF_AUDIENCE);
    return token.value;
  }
  const sa = account();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/devstorage.read_write", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`GCS token: HTTP ${r.status}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, exp: now + j.expires_in };
  return token.value;
}

function gcs(bucket: string): Storage {
  const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`;
  const upload = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`;
  const auth = async () => ({ authorization: `Bearer ${await accessToken()}` });
  return {
    async read(key) {
      const r = await fetch(`${base}/${encodeURIComponent(key)}?alt=media`, { headers: await auth(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`GCS read ${key}: HTTP ${r.status}`);
      return { text: await r.text(), etag: r.headers.get("x-goog-generation") ?? undefined };
    },
    async write(key, text, opts = {}) {
      const q = new URLSearchParams({ uploadType: "media", name: key });
      if (opts.ifMatch !== undefined) q.set("ifGenerationMatch", opts.ifMatch);
      const r = await fetch(`${upload}?${q}`, { method: "POST", headers: { ...(await auth()), "content-type": opts.contentType ?? "application/json" }, body: text, signal: AbortSignal.timeout(20_000) });
      if (r.status === 412) throw new Error(`GCS write ${key}: the object changed since it was read`);
      if (!r.ok) throw new Error(`GCS write ${key}: HTTP ${r.status}`);
    },
    async list(prefix, limit = 1000) {
      const out: string[] = [];
      let pageToken: string | undefined;
      do {
        const q = new URLSearchParams({ prefix, maxResults: String(Math.min(1000, limit - out.length)), fields: "items(name),nextPageToken" });
        if (pageToken) q.set("pageToken", pageToken);
        const r = await fetch(`${base}?${q}`, { headers: await auth(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw new Error(`GCS list ${prefix}: HTTP ${r.status}`);
        const j = (await r.json()) as { items?: { name: string }[]; nextPageToken?: string };
        out.push(...(j.items ?? []).map((i) => i.name));
        pageToken = j.nextPageToken;
      } while (pageToken && out.length < limit);
      return out;
    },
  };
}

/* ───────────────────────── Vercel Blob ───────────────────────── */

function blob(): Storage {
  const lib = () => import("@vercel/blob");
  return {
    async read(key) {
      const { get } = await lib();
      const r = await get(key, { access: "private", useCache: false }).catch(() => null);
      if (!r?.stream) return null;
      // larger (compressed) reads come back with a weak ETag, W/"…"; If-Match needs the strong form
      return { text: await new Response(r.stream).text(), etag: r.blob.etag?.replace(/^W\//, "") };
    },
    async write(key, text, opts = {}) {
      const { put } = await lib();
      await put(key, text, { access: "private", contentType: opts.contentType ?? "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60, ...(opts.ifMatch ? { ifMatch: opts.ifMatch } : {}) });
    },
    async list(prefix, limit = 1000) {
      const { list } = await lib();
      const page = await list({ prefix, limit });
      return page.blobs.map((b) => b.pathname);
    },
  };
}

/* ───────────────────────── Amazon S3 ───────────────────────── */

type AwsCreds = { id: string; secret: string; session: string; exp: number };
let aws: AwsCreds | null = null;

/**
 * Credentials for S3: temporary ones for AWS_ROLE_ARN by exchanging the function's Vercel OIDC token at the
 * regional STS, or (where the organisation's policy forbids IAM OIDC providers, as it does here) the static
 * key of an IAM user that may touch this one bucket and nothing else (S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY).
 */
async function awsCredentials(region: string, roleArn: string): Promise<AwsCreds> {
  if (!roleArn) return { id: process.env.S3_ACCESS_KEY_ID!, secret: process.env.S3_SECRET_ACCESS_KEY!, session: "", exp: Infinity };
  if (aws && aws.exp - 300 > Date.now() / 1000) return aws;
  const q = new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", Version: "2011-06-15", RoleArn: roleArn, RoleSessionName: "vercel", WebIdentityToken: await vercelOidcToken(), DurationSeconds: "3600" });
  const r = await fetch(`https://sts.${region}.amazonaws.com/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: q, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`AWS federation: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { AssumeRoleWithWebIdentityResponse: { AssumeRoleWithWebIdentityResult: { Credentials: { AccessKeyId: string; SecretAccessKey: string; SessionToken: string; Expiration: number | string } } } };
  const c = j.AssumeRoleWithWebIdentityResponse.AssumeRoleWithWebIdentityResult.Credentials;
  const exp = typeof c.Expiration === "number" ? c.Expiration : Math.floor(Date.parse(c.Expiration) / 1000);
  aws = { id: c.AccessKeyId, secret: c.SecretAccessKey, session: c.SessionToken, exp };
  return aws;
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (key: string | Buffer, s: string) => createHmac("sha256", key).update(s, "utf8").digest();

/** SigV4 for S3: the path is signed as sent (S3 is the one service that isn't double-encoded), the session token is a signed header. */
function signS3(method: string, url: URL, body: string, region: string, creds: AwsCreds, extra: Record<string, string> = {}): Record<string, string> {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payload = sha256(body);
  const headers: Record<string, string> = { ...extra, host: url.host, "x-amz-content-sha256": payload, "x-amz-date": amzDate, ...(creds.session ? { "x-amz-security-token": creds.session } : {}) };
  const names = Object.keys(headers).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const query = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const canonical = [method, url.pathname, query, names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), payload].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${creds.secret}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign, "utf8").digest("hex");
  const { host: _host, ...rest } = headers;
  return { ...rest, authorization: `AWS4-HMAC-SHA256 Credential=${creds.id}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

function s3(bucket: string, region: string, roleArn: string): Storage {
  const base = `https://${bucket}.s3.${region}.amazonaws.com`;
  const objectUrl = (key: string) => new URL(`${base}/${key.split("/").map(encodeURIComponent).join("/")}`);
  return {
    async read(key) {
      const url = objectUrl(key);
      const creds = await awsCredentials(region, roleArn);
      const r = await fetch(url, { headers: signS3("GET", url, "", region, creds), cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`S3 read ${key}: HTTP ${r.status}`);
      return { text: await r.text(), etag: r.headers.get("etag") ?? undefined };
    },
    async write(key, text, opts = {}) {
      const url = objectUrl(key);
      const creds = await awsCredentials(region, roleArn);
      const extra: Record<string, string> = { "content-type": opts.contentType ?? "application/json" };
      if (opts.ifMatch !== undefined) extra["if-match"] = opts.ifMatch;
      const r = await fetch(url, { method: "PUT", headers: signS3("PUT", url, text, region, creds, extra), body: text, signal: AbortSignal.timeout(20_000) });
      if (r.status === 412 || r.status === 409) throw new Error(`S3 write ${key}: the object changed since it was read`);
      if (!r.ok) throw new Error(`S3 write ${key}: HTTP ${r.status}`);
    },
    async list(prefix, limit = 1000) {
      const out: string[] = [];
      let token: string | undefined;
      do {
        const url = new URL(base + "/");
        url.searchParams.set("list-type", "2");
        url.searchParams.set("prefix", prefix);
        url.searchParams.set("max-keys", String(Math.min(1000, limit - out.length)));
        if (token) url.searchParams.set("continuation-token", token);
        const creds = await awsCredentials(region, roleArn);
        const r = await fetch(url, { headers: signS3("GET", url, "", region, creds), cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw new Error(`S3 list ${prefix}: HTTP ${r.status}`);
        const xml = await r.text();
        for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) out.push(m[1]!.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] ?? undefined) : undefined;
      } while (token && out.length < limit);
      return out;
    },
  };
}

let chosen: Storage | null | undefined;

/** The configured backend, or null when households live in files and counters in memory. */
export function storage(): Storage | null {
  if (chosen !== undefined) return chosen;
  if (process.env.S3_BUCKET && (process.env.AWS_ROLE_ARN || (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY))) chosen = s3(process.env.S3_BUCKET, process.env.S3_REGION || process.env.BEDROCK_REGION || "ap-southeast-2", process.env.AWS_ROLE_ARN ?? "");
  else if (process.env.GCS_BUCKET && (process.env.GCS_WIF_AUDIENCE || process.env.GCS_SA_KEY)) chosen = gcs(process.env.GCS_BUCKET);
  else if (process.env.BLOB_READ_WRITE_TOKEN) chosen = blob();
  else chosen = null;
  return chosen;
}

export const hasStorage = () => storage() !== null;
