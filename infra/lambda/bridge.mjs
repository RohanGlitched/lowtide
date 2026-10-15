// Fallback Lambda entry point for the Next.js standalone server, used only when the stack is deployed with
// Adapter=bridge (infra/deploy.py --adapter bridge), e.g. if the account can't attach the public Lambda Web
// Adapter layer. It does the adapter's job in plain Node: starts server.js on 127.0.0.1:8080 once per instance,
// then streams each Function URL request through to it (RESPONSE_STREAM), so MCP's streamed answers still stream.
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT || 8080);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer"]);

let ready = null;

function probe() {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: process.env.READINESS_PATH || "/api/health", timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Starts the Next.js server in this process (once) and waits until it answers. */
export function start(dir = HERE) {
  if (!ready) {
    ready = (async () => {
      process.env.PORT = String(PORT);
      process.env.HOSTNAME = "127.0.0.1";
      await import(pathToFileURL(path.join(dir, "server.js")).href);
      const t0 = Date.now();
      while (!(await probe())) {
        if (Date.now() - t0 > 20_000) throw new Error("the Next.js server didn't start");
        await new Promise((r) => setTimeout(r, 50));
      }
    })();
    ready.catch(() => (ready = null));
  }
  return ready;
}

/** Proxies one Lambda Function URL event (payload 2.0) to the local server, writing to a response stream. */
export async function proxy(event, responseStream, rt = globalThis.awslambda) {
  const http2 = event.requestContext?.http ?? {};
  const headers = {};
  for (const [k, v] of Object.entries(event.headers ?? {})) if (!HOP.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
  if (event.cookies?.length) headers.cookie = event.cookies.join("; ");
  const body = event.body ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8") : null;
  if (body) headers["content-length"] = String(body.length);
  const target = (event.rawPath || "/") + (event.rawQueryString ? `?${event.rawQueryString}` : "");
  await new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method: http2.method || "GET", path: target, headers }, (res) => {
      const out = {};
      const cookies = [];
      for (const [k, v] of Object.entries(res.headers)) {
        if (HOP.has(k)) continue;
        if (k === "set-cookie") cookies.push(...[v].flat());
        else out[k] = Array.isArray(v) ? v.join(", ") : v;
      }
      const stream = rt.HttpResponseStream.from(responseStream, { statusCode: res.statusCode, headers: out, cookies });
      res.on("data", (chunk) => stream.write(chunk));
      res.on("end", () => {
        stream.end();
        resolve();
      });
      res.on("error", () => {
        stream.end();
        resolve();
      });
    });
    req.on("error", (e) => {
      const stream = rt.HttpResponseStream.from(responseStream, { statusCode: 502, headers: { "content-type": "application/json" } });
      stream.end(JSON.stringify({ error: "The app server isn't answering.", detail: String(e.message || e) }));
      resolve();
    });
    if (body) req.write(body);
    req.end();
  });
}

const rt = globalThis.awslambda;
export const handler = rt
  ? rt.streamifyResponse(async (event, responseStream) => {
      await start();
      await proxy(event, responseStream, rt);
    })
  : undefined;
