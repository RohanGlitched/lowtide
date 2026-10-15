/**
 * The address a visitor actually used. Behind CloudFront the function sees its own Lambda Function URL host,
 * so the distribution's viewer-request function copies the viewer's Host into x-forwarded-host; Vercel sets
 * the same header. Links the server hands out (household MCP URLs) and the same-origin guards use this.
 */
export function publicHost(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return fwd || req.headers.get("host") || null;
}

export function publicOrigin(req: Request): string {
  const host = publicHost(req);
  if (!host) return new URL(req.url).origin;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(req.url).protocol.replace(/:$/, "");
  return `${proto === "http" && !/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "https" : proto}://${host}`;
}

/** Only this site's own pages may spend a model or voice budget: the request's Origin must be this host. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = publicHost(req);
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** The visitor's address for per-visitor caps: the first X-Forwarded-For entry (CloudFront and Vercel both add it). */
export const visitorIp = (req: Request) => (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim() || "local";
