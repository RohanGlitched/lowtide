/**
 * Lowtide's authorization server and protected resource, in one place.
 *
 * The issuer is the site's own origin (the CloudFront address on AWS, localhost in development), so the
 * metadata, the endpoints and the MCP resource always agree with the address a client used. One MCP server
 * answers at two doors: /api/mcp (guest without a token; a token is checked when sent) and /api/mcp/account
 * (always asks for a token). Both are the same resource for tokens.
 *
 * Scopes follow Amazon's Alexa+ MCP Toolkit guidance:
 *  - mcp:service   client_credentials only. Service-level: initialize, tools/list, and the guest tools that
 *                  need no household. Never user data; never a refresh token.
 *  - mcp:tools     authorization_code only. The household's tools (save, list, cancel runs; savings).
 *  - mcp:resources authorization_code only. The household's resources (tonight's plan).
 */
export const SCOPES = {
  service: "mcp:service",
  tools: "mcp:tools",
  resources: "mcp:resources",
} as const;
export const USER_SCOPES = [SCOPES.tools, SCOPES.resources];
export const ALL_SCOPES = [SCOPES.service, ...USER_SCOPES];

export const TTL = {
  /** Seconds. Alexa+ asks for expires_in <= 3600. */
  access: 3600,
  service: 3600,
  code: 300,
  /** Rolling: each refresh rotates the token and restarts the clock. */
  refresh: 90 * 24 * 3600,
};

export const MCP_PATH = "/api/mcp";
export const ACCOUNT_PATH = "/api/mcp/account";

export const endpoints = (origin: string) => ({
  issuer: origin,
  authorization: `${origin}/oauth/authorize`,
  token: `${origin}/api/oauth/token`,
  registration: `${origin}/api/oauth/register`,
  revocation: `${origin}/api/oauth/revoke`,
  resource: `${origin}${MCP_PATH}`,
  accountResource: `${origin}${ACCOUNT_PATH}`,
});

/** Resource indicators (RFC 8707) this server answers to: the MCP endpoint and its account door. */
export function isOurResource(resource: string, origin: string): boolean {
  const r = resource.replace(/\/$/, "");
  const e = endpoints(origin);
  return r === e.resource || r === e.accountResource;
}

/** RFC 8414 authorization server metadata. */
export function serverMetadata(origin: string) {
  const e = endpoints(origin);
  return {
    issuer: e.issuer,
    authorization_endpoint: e.authorization,
    token_endpoint: e.token,
    registration_endpoint: e.registration,
    revocation_endpoint: e.revocation,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    revocation_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    scopes_supported: ALL_SCOPES,
    // SEP-991: a client may use the HTTPS URL of its metadata document as its client_id
    client_id_metadata_document_supported: true,
    // RFC 9207: the redirect carries `iss`, so a client can tell which server answered
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/connect#account`,
  };
}

/**
 * RFC 9728 protected resource metadata. `path` is the resource path inserted after the well-known prefix
 * ("" for the root document, which describes /api/mcp).
 */
export function resourceMetadata(origin: string, path = "") {
  const e = endpoints(origin);
  const resource = path.replace(/\/$/, "") === ACCOUNT_PATH ? e.accountResource : e.resource;
  return {
    resource,
    authorization_servers: [e.issuer],
    scopes_supported: USER_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Lowtide",
    resource_documentation: `${origin}/connect#account`,
  };
}

export const resourceMetadataUrl = (origin: string, path: string) => `${origin}/.well-known/oauth-protected-resource${path}`;

export function parseScope(scope: string | null | undefined): string[] {
  return [...new Set((scope ?? "").split(" ").map((s) => s.trim()).filter(Boolean))];
}
