import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { OAuthError } from "./http";

/**
 * Client ID Metadata Documents (SEP-991, the MCP spec's preferred registration from 2025-11-25): a client's
 * client_id is an HTTPS URL, and the document at that URL is its registration. Lowtide fetches it at the
 * authorization endpoint only, with the guards a server-side fetch of a stranger's URL needs: HTTPS, a public
 * address (no loopback, private, link-local or metadata ranges), no redirects, five seconds, 64 KB.
 */
export interface MetadataDocument {
  client_id: string;
  client_name?: string;
  client_uri?: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  scope?: string;
}

export function isMetadataUrl(clientId: string): boolean {
  if (!clientId.startsWith("https://") || clientId.length > 2000) return false;
  try {
    const u = new URL(clientId);
    return u.protocol === "https:" && u.pathname !== "/" && !u.hash && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Addresses a server-side fetch must never reach. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    if (x.startsWith("::ffff:")) return isPrivateAddress(x.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x.replace(/^\[|\]$/g, ""));
  }
  return true;
}

type Deps = {
  fetch?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
};

const defaultResolve = async (host: string) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

const cache = new Map<string, { doc: MetadataDocument; until: number }>();
const CACHE_MS = 5 * 60_000;

export function clearMetadataCacheForTests() {
  cache.clear();
}

export async function fetchMetadataDocument(clientId: string, deps: Deps = {}): Promise<MetadataDocument> {
  const hit = cache.get(clientId);
  if (hit && hit.until > Date.now()) return hit.doc;
  if (!isMetadataUrl(clientId)) throw new OAuthError("invalid_client", "A client_id URL must be HTTPS with a path.");
  const url = new URL(clientId);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await (deps.resolve ?? defaultResolve)(host).catch(() => []);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new OAuthError("invalid_client", "Lowtide can't fetch that client's metadata document.");
  }
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5000) });
  } catch {
    throw new OAuthError("invalid_client", "Lowtide couldn't fetch that client's metadata document.");
  }
  if (!res.ok) throw new OAuthError("invalid_client", `The client's metadata document answered HTTP ${res.status}.`);
  if (Number(res.headers.get("content-length") ?? 0) > 65_536) throw new OAuthError("invalid_client", "The client's metadata document is too large.");
  const text = await res.text();
  if (text.length > 65_536) throw new OAuthError("invalid_client", "The client's metadata document is too large.");
  let doc: MetadataDocument;
  try {
    doc = JSON.parse(text) as MetadataDocument;
  } catch {
    throw new OAuthError("invalid_client", "The client's metadata document isn't JSON.");
  }
  if (!doc || typeof doc !== "object" || doc.client_id !== clientId) {
    throw new OAuthError("invalid_client", "The client's metadata document names a different client_id.");
  }
  if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0 || doc.redirect_uris.some((u) => typeof u !== "string")) {
    throw new OAuthError("invalid_client", "The client's metadata document has no redirect_uris.");
  }
  // A document anyone can read can't hold a secret, so these clients are public (PKCE is their proof).
  if (doc.token_endpoint_auth_method && doc.token_endpoint_auth_method !== "none") {
    throw new OAuthError("invalid_client", "Lowtide accepts metadata-document clients with token_endpoint_auth_method none.");
  }
  if (doc.grant_types?.includes("client_credentials")) {
    throw new OAuthError("invalid_client", "A metadata-document client can't use client_credentials.");
  }
  cache.set(clientId, { doc, until: Date.now() + CACHE_MS });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return doc;
}
