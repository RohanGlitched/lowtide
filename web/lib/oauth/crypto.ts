import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque tokens. Nothing here is signed, so there is no signing key to keep: every token is 256 random bits,
 * the store holds only its SHA-256, and the resource server looks the hash up. That makes revocation
 * immediate and leaves no key material in the stack, the environment or the bucket.
 */
export const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");
export const sha256b64url = (s: string) => createHash("sha256").update(s).digest("base64url");
export const random = (bytes = 32) => randomBytes(bytes).toString("base64url");

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
/** Lower-case base32 ids: safe in keys and URLs, no `_` or `.` so they can sit inside a token. */
export function randomId(length = 20): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => B32[b & 31]).join("");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** RFC 7636: 43 to 128 characters from the unreserved set. */
export const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
/** S256 challenges are a base64url SHA-256: exactly 43 characters. */
export const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

/** PKCE with S256 only (OAuth 2.1 and the MCP spec; `plain` is refused at the authorization endpoint). */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier) || !CHALLENGE.test(challenge)) return false;
  return safeEqual(sha256b64url(verifier), challenge);
}

export const TOKEN = {
  access: "lta_",
  refresh: "ltr_",
  code: "ltc_",
  secret: "lts_",
} as const;

export const newAccessToken = () => TOKEN.access + random();
export const newCode = () => TOKEN.code + random();
export const newClientSecret = () => TOKEN.secret + random();
/** A refresh token names its grant (not secret) and carries 256 random bits (the secret part). */
export const newRefreshToken = (grantId: string) => `${TOKEN.refresh}${grantId}.${random()}`;

export function grantOfRefreshToken(token: string): string | null {
  const m = /^ltr_([a-z2-7]{20})\.[A-Za-z0-9_-]{43}$/.exec(token);
  return m ? m[1]! : null;
}
