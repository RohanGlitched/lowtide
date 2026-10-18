import { newClientSecret, randomId, safeEqual, sha256hex } from "./crypto";
import { fetchMetadataDocument, isMetadataUrl } from "./cimd";
import { OAuthError } from "./http";
import { getRecord, putRecord } from "./kv";
import { ALL_SCOPES, parseScope } from "./config";

export type AuthMethod = "none" | "client_secret_basic" | "client_secret_post";
export type GrantType = "authorization_code" | "refresh_token" | "client_credentials";

export interface Client {
  client_id: string;
  client_name: string;
  client_uri?: string;
  redirect_uris: string[];
  grant_types: GrantType[];
  token_endpoint_auth_method: AuthMethod;
  scope?: string;
  /** SHA-256 of the secret for confidential clients; the secret itself is shown once, at registration. */
  secret_hash?: string;
  client_id_issued_at: number;
  /** registered: RFC 7591 (stored); document: a client ID metadata document (fetched, never stored). */
  kind: "registered" | "document";
}

const METHODS: AuthMethod[] = ["none", "client_secret_basic", "client_secret_post"];
const GRANTS: GrantType[] = ["authorization_code", "refresh_token", "client_credentials"];
const BAD_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "about:", "blob:", "ftp:", "ws:", "wss:"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** HTTPS anywhere, plain HTTP only on loopback (RFC 8252 §7.3), or a native app's private scheme (§7.1). */
export function checkRedirectUri(uri: string): string | null {
  if (typeof uri !== "string" || uri.length > 2000) return "A redirect URI is missing or too long.";
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return `${uri.slice(0, 80)} isn't an absolute URI.`;
  }
  if (u.hash) return "A redirect URI can't have a fragment.";
  if (BAD_SCHEMES.has(u.protocol)) return `${u.protocol} redirect URIs aren't allowed.`;
  if (u.protocol === "http:" && !LOOPBACK.has(u.hostname)) return "Plain http redirect URIs are only allowed on localhost.";
  return null;
}

/** Exact match, except that a loopback redirect may use any port (RFC 8252 §7.3). */
export function redirectMatches(registered: string, asked: string): boolean {
  if (registered === asked) return true;
  try {
    const a = new URL(registered);
    const b = new URL(asked);
    return a.protocol === "http:" && b.protocol === "http:" && LOOPBACK.has(a.hostname) && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** RFC 7591 dynamic registration. Returns the stored client and, for a confidential one, its secret (once). */
export async function registerClient(meta: Record<string, unknown>): Promise<{ client: Client; secret?: string }> {
  const method = (meta.token_endpoint_auth_method ?? "client_secret_basic") as AuthMethod;
  if (!METHODS.includes(method)) {
    throw new OAuthError("invalid_client_metadata", `token_endpoint_auth_method must be one of ${METHODS.join(", ")}.`);
  }
  const grants = (meta.grant_types ?? ["authorization_code", "refresh_token"]) as GrantType[];
  if (!Array.isArray(grants) || grants.length === 0 || grants.some((g) => !GRANTS.includes(g))) {
    throw new OAuthError("invalid_client_metadata", `grant_types may contain ${GRANTS.join(", ")}.`);
  }
  if (grants.includes("client_credentials") && method === "none") {
    throw new OAuthError("invalid_client_metadata", "client_credentials needs a confidential client (client_secret_basic or client_secret_post).");
  }
  if (grants.includes("refresh_token") && !grants.includes("authorization_code")) {
    throw new OAuthError("invalid_client_metadata", "refresh_token comes with authorization_code.");
  }
  const responseTypes = meta.response_types ?? (grants.includes("authorization_code") ? ["code"] : []);
  if (!Array.isArray(responseTypes) || responseTypes.some((r) => r !== "code")) {
    throw new OAuthError("invalid_client_metadata", "response_types may only contain code.");
  }
  const redirects = (meta.redirect_uris ?? []) as string[];
  if (!Array.isArray(redirects) || redirects.length > 10) throw new OAuthError("invalid_redirect_uri", "Register between one and ten redirect URIs.");
  if (grants.includes("authorization_code") && redirects.length === 0) {
    throw new OAuthError("invalid_redirect_uri", "authorization_code needs at least one redirect URI.");
  }
  for (const r of redirects) {
    const problem = checkRedirectUri(r);
    if (problem) throw new OAuthError("invalid_redirect_uri", problem);
  }
  const scope = str(meta.scope, 200);
  if (scope && parseScope(scope).some((s) => !ALL_SCOPES.includes(s as never))) {
    throw new OAuthError("invalid_client_metadata", `scope may contain ${ALL_SCOPES.join(", ")}.`);
  }
  const clientUri = str(meta.client_uri, 300);
  if (clientUri && !/^https:\/\//.test(clientUri)) throw new OAuthError("invalid_client_metadata", "client_uri must be HTTPS.");

  const secret = method === "none" ? undefined : newClientSecret();
  const client: Client = {
    client_id: `ltc${randomId(20)}`,
    client_name: str(meta.client_name, 80) ?? "An unnamed app",
    client_uri: clientUri,
    redirect_uris: redirects,
    grant_types: grants,
    token_endpoint_auth_method: method,
    scope,
    secret_hash: secret ? sha256hex(secret) : undefined,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    kind: "registered",
  };
  await putRecord(`clients/${client.client_id}`, client);
  return { client, secret };
}

/** The RFC 7591 response: the client's metadata, its id, and its secret the one time it is shown. */
export function registrationResponse(client: Client, secret?: string) {
  return {
    client_id: client.client_id,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: client.client_id_issued_at,
    client_name: client.client_name,
    ...(client.client_uri ? { client_uri: client.client_uri } : {}),
    redirect_uris: client.redirect_uris,
    grant_types: client.grant_types,
    response_types: client.grant_types.includes("authorization_code") ? ["code"] : [],
    token_endpoint_auth_method: client.token_endpoint_auth_method,
    ...(client.scope ? { scope: client.scope } : {}),
  };
}

const CLIENT_ID = /^ltc[a-z2-7]{20}$/;

/** A registered client, or a metadata-document client fetched from its URL. Null when there is no such client. */
export async function findClient(clientId: string): Promise<Client | null> {
  if (CLIENT_ID.test(clientId)) return (await getRecord<Client>(`clients/${clientId}`))?.value ?? null;
  if (isMetadataUrl(clientId)) {
    const doc = await fetchMetadataDocument(clientId);
    const grants = (doc.grant_types ?? ["authorization_code", "refresh_token"]).filter((g): g is GrantType => g === "authorization_code" || g === "refresh_token");
    return {
      client_id: doc.client_id,
      client_name: str(doc.client_name, 80) ?? new URL(doc.client_id).hostname,
      client_uri: str(doc.client_uri, 300),
      redirect_uris: doc.redirect_uris.filter((r) => !checkRedirectUri(r)),
      grant_types: grants,
      token_endpoint_auth_method: "none",
      client_id_issued_at: 0,
      kind: "document",
    };
  }
  return null;
}

/**
 * Client authentication at the token and revocation endpoints: HTTP Basic or form secret for confidential
 * clients (Alexa+ sends Basic), client_id alone for public ones. Exactly one method per request.
 */
export async function authenticateClient(req: Request, form: URLSearchParams): Promise<Client> {
  const header = req.headers.get("authorization");
  let id = form.get("client_id") ?? undefined;
  let secret = form.get("client_secret") ?? undefined;
  let basic = false;
  if (header) {
    const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
    if (!m) throw new OAuthError("invalid_client", "Use HTTP Basic for client authentication.", 401, true);
    if (secret) throw new OAuthError("invalid_request", "Send the client secret one way only.");
    const decoded = Buffer.from(m[1]!, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon < 0) throw new OAuthError("invalid_client", "Malformed Basic credentials.", 401, true);
    let bid: string;
    try {
      // RFC 6749 §2.3.1: both parts are form-urlencoded before they are joined
      bid = decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, " "));
      secret = decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, " "));
    } catch {
      throw new OAuthError("invalid_client", "Malformed Basic credentials.", 401, true);
    }
    if (id && id !== bid) throw new OAuthError("invalid_request", "client_id doesn't match the Basic credentials.");
    id = bid;
    basic = true;
  }
  if (!id) throw new OAuthError("invalid_client", "Say which client this is (client_id).", 401);
  const client = await findClient(id).catch((e) => {
    if (e instanceof OAuthError) throw new OAuthError("invalid_client", e.description, 401, basic);
    throw e;
  });
  if (!client) throw new OAuthError("invalid_client", "Lowtide doesn't know this client.", 401, basic);
  if (client.token_endpoint_auth_method === "none") {
    if (secret) throw new OAuthError("invalid_client", "This is a public client; it has no secret.", 401, basic);
    return client;
  }
  if (!secret || !client.secret_hash || !safeEqual(sha256hex(secret), client.secret_hash)) {
    throw new OAuthError("invalid_client", "The client credentials are wrong.", 401, basic);
  }
  return client;
}
