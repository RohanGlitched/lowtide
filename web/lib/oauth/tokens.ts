import { grantOfRefreshToken, newAccessToken, newRefreshToken, pkceMatches, safeEqual, sha256hex, TOKEN } from "./crypto";
import { authenticateClient, type Client } from "./clients";
import { OAuthError, readForm } from "./http";
import { Conflict, getRecord, putRecord, updateRecord } from "./kv";
import { ALL_SCOPES, isOurResource, parseScope, SCOPES, TTL } from "./config";
import type { CodeRecord } from "./authorize";
import { log } from "../log";

/** What the store keeps for an access token, keyed by the token's SHA-256. */
export interface AccessRecord {
  clientId: string;
  /** The household this token acts for; null for a service (client_credentials) token. */
  home: string | null;
  scope: string[];
  resource: string;
  iat: number;
  exp: number;
  grantId: string | null;
  revoked?: boolean;
}

/** One person's consent for one client and one household: what refresh tokens renew and revocation ends. */
export interface Grant {
  id: string;
  clientId: string;
  home: string;
  scope: string[];
  resource: string;
  createdAt: number;
  /** SHA-256 of the current refresh token (none if the client didn't register refresh_token). */
  refreshHash?: string;
  /** SHA-256 of the one before: presenting it again means the token leaked, and the grant is revoked. */
  prevRefreshHash?: string;
  refreshExp?: number;
  revoked: boolean;
  revokedReason?: string;
  /** Live access tokens (hashes), so revoking the grant revokes them too. */
  access: { h: string; exp: number }[];
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

const now = () => Math.floor(Date.now() / 1000);
const sameResource = (a: string, b: string) => a.replace(/\/$/, "") === b.replace(/\/$/, "");

function checkResource(form: URLSearchParams, origin: string, bound?: string): string | null {
  const r = form.get("resource");
  if (r === null) return null;
  if (!isOurResource(r, origin)) throw new OAuthError("invalid_target", "Lowtide issues tokens for its own MCP server only.");
  if (bound && !sameResource(r, bound)) throw new OAuthError("invalid_target", "That isn't the resource this grant was made for.");
  return r.replace(/\/$/, "");
}

async function mintAccess(rec: Omit<AccessRecord, "iat" | "exp">, ttl: number): Promise<{ token: string; h: string; exp: number }> {
  const token = newAccessToken();
  const h = sha256hex(token);
  const iat = now();
  const exp = iat + ttl;
  await putRecord<AccessRecord>(`access/${h}`, { ...rec, iat, exp });
  return { token, h, exp };
}

/** The token endpoint (RFC 6749 §3.2): authorization_code with PKCE, refresh_token (rotating), client_credentials. */
export async function tokenRequest(req: Request, origin: string): Promise<TokenResponse> {
  const form = await readForm(req);
  const grantType = form.get("grant_type");
  if (!grantType) throw new OAuthError("invalid_request", "grant_type is missing.");
  if (!["authorization_code", "refresh_token", "client_credentials"].includes(grantType)) {
    throw new OAuthError("unsupported_grant_type", "Lowtide supports authorization_code, refresh_token and client_credentials.");
  }
  const client = await authenticateClient(req, form);
  if (!client.grant_types.includes(grantType as never)) {
    throw new OAuthError("unauthorized_client", `This client isn't registered for ${grantType}.`);
  }
  const out =
    grantType === "authorization_code" ? await exchangeCode(client, form, origin)
    : grantType === "refresh_token" ? await refresh(client, form, origin)
    : await clientCredentials(client, form, origin);
  log({ evt: "oauth", step: "token", grant: grantType, ok: true, service: grantType === "client_credentials" });
  return out;
}

async function exchangeCode(client: Client, form: URLSearchParams, origin: string): Promise<TokenResponse> {
  const code = form.get("code");
  const verifier = form.get("code_verifier");
  if (!code) throw new OAuthError("invalid_request", "code is missing.");
  if (!verifier) throw new OAuthError("invalid_request", "code_verifier is missing (PKCE is required).");
  if (!code.startsWith(TOKEN.code)) throw new OAuthError("invalid_grant", "That code isn't valid.");
  const key = `codes/${sha256hex(code)}`;
  const cur = await getRecord<CodeRecord>(key);
  const c = cur?.value;
  if (!cur || !c || c.clientId !== client.client_id) throw new OAuthError("invalid_grant", "That code isn't valid.");
  if (c.used) {
    // RFC 6749 §4.1.2: a replayed code revokes what it was exchanged for
    await revokeGrant(c.grantId, "authorization code replayed");
    throw new OAuthError("invalid_grant", "That code has already been used.");
  }
  if (c.exp < now()) throw new OAuthError("invalid_grant", "That code has expired. Start again.");
  const redirect = form.get("redirect_uri");
  if ((c.redirectUriSent || redirect !== null) && redirect !== c.redirectUri) {
    throw new OAuthError("invalid_grant", "redirect_uri doesn't match the authorization request.");
  }
  if (!pkceMatches(verifier, c.challenge)) throw new OAuthError("invalid_grant", "code_verifier doesn't match the code_challenge.");
  checkResource(form, origin, c.resource);
  try {
    await putRecord<CodeRecord>(key, { ...c, used: true }, cur.etag);
  } catch (e) {
    if (e instanceof Conflict) throw new OAuthError("invalid_grant", "That code has already been used.");
    throw e;
  }

  const access = await mintAccess({ clientId: client.client_id, home: c.home, scope: c.scope, resource: c.resource, grantId: c.grantId }, TTL.access);
  const withRefresh = client.grant_types.includes("refresh_token");
  const refreshToken = withRefresh ? newRefreshToken(c.grantId) : undefined;
  const grant: Grant = {
    id: c.grantId,
    clientId: client.client_id,
    home: c.home,
    scope: c.scope,
    resource: c.resource,
    createdAt: now(),
    refreshHash: refreshToken ? sha256hex(refreshToken) : undefined,
    refreshExp: refreshToken ? now() + TTL.refresh : undefined,
    revoked: false,
    access: [{ h: access.h, exp: access.exp }],
  };
  await putRecord<Grant>(`grants/${grant.id}`, grant);
  return { access_token: access.token, token_type: "Bearer", expires_in: TTL.access, scope: c.scope.join(" "), ...(refreshToken ? { refresh_token: refreshToken } : {}) };
}

async function refresh(client: Client, form: URLSearchParams, origin: string): Promise<TokenResponse> {
  const token = form.get("refresh_token");
  if (!token) throw new OAuthError("invalid_request", "refresh_token is missing.");
  const grantId = grantOfRefreshToken(token);
  if (!grantId) throw new OAuthError("invalid_grant", "That refresh token isn't valid.");
  const cur = await getRecord<Grant>(`grants/${grantId}`);
  const g = cur?.value;
  if (!cur || !g || g.clientId !== client.client_id || g.revoked) throw new OAuthError("invalid_grant", "That refresh token isn't valid.");
  const h = sha256hex(token);
  if (g.prevRefreshHash && safeEqual(h, g.prevRefreshHash)) {
    // OAuth 2.1 §4.3.1: a rotated-out refresh token came back, so one of the two copies is stolen
    await revokeGrant(g.id, "refresh token replayed");
    throw new OAuthError("invalid_grant", "That refresh token was already used. Connect Lowtide again.");
  }
  if (!g.refreshHash || !safeEqual(h, g.refreshHash)) throw new OAuthError("invalid_grant", "That refresh token isn't valid.");
  if ((g.refreshExp ?? 0) < now()) throw new OAuthError("invalid_grant", "That refresh token has expired. Connect Lowtide again.");
  const asked = parseScope(form.get("scope"));
  if (asked.some((s) => !g.scope.includes(s))) throw new OAuthError("invalid_scope", "A refresh can't widen the grant's scope.");
  const scope = asked.length ? asked : g.scope;
  checkResource(form, origin, g.resource);

  // The new access token is written first: if the grant update loses a race, it is an orphan nobody holds.
  const access = await mintAccess({ clientId: client.client_id, home: g.home, scope, resource: g.resource, grantId: g.id }, TTL.access);
  const next = newRefreshToken(g.id);
  const t = now();
  const updated: Grant = {
    ...g,
    prevRefreshHash: g.refreshHash,
    refreshHash: sha256hex(next),
    refreshExp: t + TTL.refresh,
    access: [...g.access.filter((a) => a.exp > t), { h: access.h, exp: access.exp }].slice(-20),
  };
  try {
    await putRecord<Grant>(`grants/${g.id}`, updated, cur.etag);
  } catch (e) {
    if (e instanceof Conflict) throw new OAuthError("invalid_grant", "That refresh token was just used. Try again with the newest one.");
    throw e;
  }
  return { access_token: access.token, token_type: "Bearer", expires_in: TTL.access, scope: scope.join(" "), refresh_token: next };
}

/**
 * Tier 1 of the Alexa+ guidance: a service token for a confidential client, scope mcp:service, no refresh
 * token, and the resource indicator required and checked. It carries no household and so no user data.
 * A request for user scopes is narrowed to mcp:service (RFC 6749 §3.3); unknown scopes are an error.
 */
async function clientCredentials(client: Client, form: URLSearchParams, origin: string): Promise<TokenResponse> {
  if (client.token_endpoint_auth_method === "none") throw new OAuthError("unauthorized_client", "client_credentials needs a confidential client.");
  const resource = checkResource(form, origin);
  if (!resource) throw new OAuthError("invalid_request", "resource is required: the MCP server's URL.");
  const asked = parseScope(form.get("scope"));
  if (asked.some((s) => !ALL_SCOPES.includes(s as never))) throw new OAuthError("invalid_scope", `Lowtide's scopes are ${ALL_SCOPES.join(", ")}.`);
  const scope = [SCOPES.service];
  const access = await mintAccess({ clientId: client.client_id, home: null, scope, resource, grantId: null }, TTL.service);
  return { access_token: access.token, token_type: "Bearer", expires_in: TTL.service, scope: scope.join(" ") };
}

/** Ends a grant and every live access token it issued. Idempotent. */
export async function revokeGrant(grantId: string, reason: string): Promise<void> {
  const g = await updateRecord<Grant>(`grants/${grantId}`, (cur) => (cur.revoked ? null : { ...cur, revoked: true, revokedReason: reason }));
  if (!g) return;
  await Promise.all(g.access.map((a) => updateRecord<AccessRecord>(`access/${a.h}`, (r) => (r.revoked ? null : { ...r, revoked: true })).catch(() => null)));
  log({ evt: "oauth", step: "revoke", ok: true, reason });
}

/**
 * RFC 7009 revocation. A refresh token ends its whole grant; an access token just itself. Unknown or
 * foreign tokens get the same 200 as real ones, so the endpoint can't be used to test tokens.
 */
export async function revokeRequest(req: Request): Promise<void> {
  const form = await readForm(req);
  const token = form.get("token");
  if (!token) throw new OAuthError("invalid_request", "token is missing.");
  const client = await authenticateClient(req, form);
  if (token.startsWith(TOKEN.refresh)) {
    const id = grantOfRefreshToken(token);
    if (!id) return;
    const g = (await getRecord<Grant>(`grants/${id}`))?.value;
    if (g && g.clientId === client.client_id && g.refreshHash && safeEqual(sha256hex(token), g.refreshHash)) await revokeGrant(id, "revoked by the client");
    return;
  }
  if (token.startsWith(TOKEN.access)) {
    await updateRecord<AccessRecord>(`access/${sha256hex(token)}`, (r) => (r.clientId !== client.client_id || r.revoked ? null : { ...r, revoked: true })).catch(() => null);
  }
}

/** The resource server's check: a live, unrevoked token issued for this server. */
export async function verifyAccessToken(token: string, origin: string): Promise<AccessRecord | null> {
  if (!token.startsWith(TOKEN.access) || token.length > 100) return null;
  const rec = (await getRecord<AccessRecord>(`access/${sha256hex(token)}`))?.value;
  if (!rec || rec.revoked || rec.exp <= now() || !isOurResource(rec.resource, origin)) return null;
  return rec;
}
