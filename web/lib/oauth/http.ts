import { CORS } from "../mcp/handler";

/** RFC 6749 §5.2 error codes, plus RFC 8707's invalid_target and RFC 7591's registration errors. */
export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "invalid_target"
  | "access_denied"
  | "unsupported_response_type"
  | "invalid_redirect_uri"
  | "invalid_client_metadata"
  | "server_error"
  | "temporarily_unavailable";

const STATUS: Partial<Record<OAuthErrorCode, number>> = {
  invalid_client: 401,
  access_denied: 403,
  server_error: 500,
  temporarily_unavailable: 503,
};

export class OAuthError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    readonly description: string,
    readonly status = STATUS[code] ?? 400,
    /** invalid_client after HTTP Basic: answer with a Basic challenge (RFC 6749 §5.2). */
    readonly basicChallenge = false,
  ) {
    super(description);
  }
}

const HEADERS: Record<string, string> = {
  ...CORS,
  "cache-control": "no-store",
  pragma: "no-cache",
  "access-control-expose-headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...HEADERS, ...extra } });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof OAuthError) {
    return json(
      { error: e.code, error_description: e.description },
      e.status,
      e.basicChallenge ? { "www-authenticate": 'Basic realm="Lowtide", charset="UTF-8"' } : {},
    );
  }
  console.error("oauth:", e instanceof Error ? e.message : e);
  return json({ error: "server_error", error_description: "Something went wrong on Lowtide's side. Try again." }, 500);
}

export const optionsResponse = () => new Response(null, { status: 204, headers: HEADERS });

/** Token and revocation requests are form-encoded (RFC 6749 §3.2); repeated parameters are refused (§3.1). */
export async function readForm(req: Request): Promise<URLSearchParams> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") {
    throw new OAuthError("invalid_request", "Send the request as application/x-www-form-urlencoded.");
  }
  const text = await req.text();
  if (text.length > 16_384) throw new OAuthError("invalid_request", "The request is too large.");
  const form = new URLSearchParams(text);
  const seen = new Set<string>();
  for (const k of form.keys()) {
    if (seen.has(k)) throw new OAuthError("invalid_request", `The ${k} parameter appears more than once.`);
    seen.add(k);
  }
  return form;
}

/** A per-instance limiter for endpoints that create records (registration, new households from consent). */
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= max) return false;
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return true;
  };
}
