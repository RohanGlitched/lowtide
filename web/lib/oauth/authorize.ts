import { CHALLENGE, newCode, randomId, sha256hex } from "./crypto";
import { findClient, redirectMatches, type Client } from "./clients";
import { OAuthError, type OAuthErrorCode } from "./http";
import { putRecord } from "./kv";
import { endpoints, isOurResource, parseScope, TTL, USER_SCOPES } from "./config";
import { HOME_ID } from "../store";

/** The authorization request's parameters, as the consent page receives them and posts them back. */
export const AUTHORIZE_PARAMS = ["response_type", "client_id", "redirect_uri", "state", "scope", "code_challenge", "code_challenge_method", "resource"] as const;
export type AuthorizeParams = Partial<Record<(typeof AUTHORIZE_PARAMS)[number], string>>;

export interface AuthorizeRequest {
  client: Client;
  redirectUri: string;
  /** Whether redirect_uri was in the request (then the token request must repeat it). */
  redirectUriSent: boolean;
  state?: string;
  scope: string[];
  challenge: string;
  resource: string;
}

export type Checked =
  /** Don't redirect: the client or its redirect URI can't be trusted. Show the person an error instead. */
  | { kind: "fatal"; message: string }
  /** Send the error back to the client's redirect URI. */
  | { kind: "error"; redirect: string }
  | { kind: "ok"; request: AuthorizeRequest };

export function pickParams(source: URLSearchParams | Record<string, string | string[] | undefined>): AuthorizeParams {
  const out: AuthorizeParams = {};
  for (const k of AUTHORIZE_PARAMS) {
    const v = source instanceof URLSearchParams ? source.get(k) : source[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === "string" && s.length <= 2048) out[k] = s;
  }
  return out;
}

/** Appends the response to a redirect URI, keeping its own query (RFC 6749 §3.1.2), with `iss` (RFC 9207). */
export function redirectWith(uri: string, params: Record<string, string | undefined>, origin: string): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries({ ...params, iss: endpoints(origin).issuer })) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * Validates an authorization request in the order RFC 6749 §4.1.2.1 asks: the client and redirect URI first
 * (errors shown to the person, never redirected), then everything else (errors sent back to the client).
 */
export async function checkAuthorize(p: AuthorizeParams, origin: string): Promise<Checked> {
  if (!p.client_id) return { kind: "fatal", message: "The app didn't say who it is (no client_id)." };
  let client: Client | null;
  try {
    client = await findClient(p.client_id);
  } catch (e) {
    return { kind: "fatal", message: e instanceof OAuthError ? e.description : "Lowtide couldn't look this app up." };
  }
  if (!client) return { kind: "fatal", message: "Lowtide doesn't know this app. It needs to register first." };
  let redirectUri = p.redirect_uri;
  if (!redirectUri) {
    if (client.redirect_uris.length !== 1) return { kind: "fatal", message: "The app didn't say where to send you back (no redirect_uri)." };
    redirectUri = client.redirect_uris[0]!;
  } else if (!client.redirect_uris.some((r) => redirectMatches(r, redirectUri!))) {
    return { kind: "fatal", message: "The app asked to send you back to an address it never registered." };
  }

  const fail = (error: OAuthErrorCode, description: string): Checked => ({
    kind: "error",
    redirect: redirectWith(redirectUri!, { error, error_description: description, state: p.state }, origin),
  });
  if (!client.grant_types.includes("authorization_code")) return fail("unauthorized_client", "This client isn't registered for authorization_code.");
  if (p.response_type !== "code") return fail("unsupported_response_type", "Lowtide supports response_type=code only.");
  if (!p.code_challenge) return fail("invalid_request", "PKCE is required: send code_challenge with code_challenge_method=S256.");
  if (p.code_challenge_method !== "S256") return fail("invalid_request", "Lowtide supports code_challenge_method S256 only.");
  if (!CHALLENGE.test(p.code_challenge)) return fail("invalid_request", "code_challenge isn't a base64url SHA-256.");
  const resource = p.resource ? p.resource.replace(/\/$/, "") : endpoints(origin).resource;
  if (!isOurResource(resource, origin)) return fail("invalid_target", `Lowtide issues tokens for ${endpoints(origin).resource} only.`);
  const asked = parseScope(p.scope);
  // A household grant carries the user scopes; mcp:service (and anything unknown) is dropped, not granted.
  const scope = asked.length === 0 ? USER_SCOPES : USER_SCOPES.filter((s) => asked.includes(s));
  if (scope.length === 0) return fail("invalid_scope", `Ask for ${USER_SCOPES.join(" and ")}.`);

  return { kind: "ok", request: { client, redirectUri, redirectUriSent: Boolean(p.redirect_uri), state: p.state, scope, challenge: p.code_challenge, resource } };
}

export interface CodeRecord {
  clientId: string;
  redirectUri: string;
  redirectUriSent: boolean;
  challenge: string;
  scope: string[];
  resource: string;
  home: string;
  /** The grant this code becomes; if the code is ever replayed, that grant is revoked. */
  grantId: string;
  exp: number;
  used: boolean;
}

/** Issues a single-use code for the household the person chose, and the redirect that carries it. */
export async function issueCode(request: AuthorizeRequest, home: string, origin: string): Promise<string> {
  const code = newCode();
  const record: CodeRecord = {
    clientId: request.client.client_id,
    redirectUri: request.redirectUri,
    redirectUriSent: request.redirectUriSent,
    challenge: request.challenge,
    scope: request.scope,
    resource: request.resource,
    home,
    grantId: randomId(20),
    exp: Math.floor(Date.now() / 1000) + TTL.code,
    used: false,
  };
  await putRecord(`codes/${sha256hex(code)}`, record);
  return redirectWith(request.redirectUri, { code, state: request.state }, origin);
}

export const deniedRedirect = (request: AuthorizeRequest, origin: string) =>
  redirectWith(request.redirectUri, { error: "access_denied", error_description: "The person said no.", state: request.state }, origin);

/** A household id from a pasted Lowtide link (…/api/mcp/h/<id>) or the bare id. */
export function homeIdFrom(link: string): string | null {
  const t = link.trim();
  if (HOME_ID.test(t)) return t;
  const m = /\/api\/mcp\/h\/([a-z2-7]{10})(?:[/?#]|$)/.exec(t);
  return m ? m[1]! : null;
}
