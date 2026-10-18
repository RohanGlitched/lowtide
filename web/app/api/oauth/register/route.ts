import { registerClient, registrationResponse } from "@/lib/oauth/clients";
import { errorResponse, json, OAuthError, optionsResponse, rateLimiter } from "@/lib/oauth/http";
import { visitorIp } from "@/lib/origin";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 15;

/** At most 30 registrations per address per hour (per instance): enough for any client, not for a flood. */
const allowed = rateLimiter(30, 3600_000);

/**
 * RFC 7591 dynamic client registration, open (no initial access token), as MCP clients expect. A public
 * client (token_endpoint_auth_method none) gets an id; a confidential one also gets a secret, shown once
 * and stored only as its hash. client_credentials clients (Alexa+ Tier 1) get mcp:service and nothing more.
 */
export async function POST(req: Request) {
  try {
    if (!allowed(visitorIp(req))) throw new OAuthError("temporarily_unavailable", "Too many registrations from here. Try again in an hour.", 429);
    if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      throw new OAuthError("invalid_client_metadata", "Send the client metadata as JSON.");
    }
    const text = await req.text();
    if (text.length > 16_384) throw new OAuthError("invalid_client_metadata", "The client metadata is too large.");
    let meta: unknown;
    try {
      meta = JSON.parse(text);
    } catch {
      throw new OAuthError("invalid_client_metadata", "The client metadata isn't JSON.");
    }
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new OAuthError("invalid_client_metadata", "The client metadata must be a JSON object.");
    const { client, secret } = await registerClient(meta as Record<string, unknown>);
    log({ evt: "oauth", step: "register", ok: true, service: client.grant_types.includes("client_credentials") });
    return json(registrationResponse(client, secret), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
export const OPTIONS = optionsResponse;
