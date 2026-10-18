import { lowtideHandler, withCors } from "../mcp/handler";
import { publicOrigin } from "../origin";
import { log } from "../log";
import { resourceMetadataUrl, SCOPES, USER_SCOPES } from "./config";
import { verifyAccessToken, type AccessRecord } from "./tokens";

/** Tools that read or write a household: a household token with mcp:tools, never a service token. */
export const HOUSEHOLD_TOOLS = new Set(["schedule_run", "list_runs", "cancel_run", "get_savings", "set_home"]);
const HOUSEHOLD_RESOURCE = /^lowtide:\/\/household\//;

const guest = lowtideHandler(null);

function challenge(origin: string, path: string, status: 401 | 403, error?: { code: string; description: string; scope?: string }): Response {
  const parts = [`resource_metadata="${resourceMetadataUrl(origin, path)}"`, `scope="${error?.scope ?? USER_SCOPES.join(" ")}"`];
  if (error) parts.push(`error="${error.code}"`, `error_description="${error.description.replace(/"/g, "'")}"`);
  const res = Response.json(
    { error: error?.code ?? "unauthorized", error_description: error?.description ?? "Sign in to Lowtide to use your household." },
    { status, headers: { "www-authenticate": `Bearer ${parts.join(", ")}`, "cache-control": "no-store" } },
  );
  return exposeAuth(withCors(res));
}

function exposeAuth(res: Response): Response {
  res.headers.set("access-control-expose-headers", "mcp-session-id, mcp-protocol-version, www-authenticate");
  return res;
}

type Rpc = { method?: string; params?: { name?: string; uri?: string } };

/** What a JSON-RPC body (one message or a batch) asks for that needs more than a service token. */
async function needs(req: Request): Promise<{ tools: boolean; household: boolean; resources: boolean }> {
  const out = { tools: false, household: false, resources: false };
  if (req.method !== "POST") return out;
  let body: unknown;
  try {
    body = await req.clone().json();
  } catch {
    return out;
  }
  for (const m of (Array.isArray(body) ? body : [body]) as Rpc[]) {
    if (m?.method === "tools/call") {
      out.tools = true;
      if (HOUSEHOLD_TOOLS.has(String(m.params?.name))) out.household = true;
    }
    if (m?.method === "resources/read" && HOUSEHOLD_RESOURCE.test(String(m.params?.uri ?? ""))) out.resources = true;
  }
  return out;
}

/**
 * The MCP endpoint behind OAuth. Without an Authorization header it is the guest server, unless `required`
 * (the /api/mcp/account door, or MCP_AUTH=required), which answers 401 with the protected resource metadata
 * (RFC 9728 §5.1) so a client can discover the authorization server and sign in. With a bearer token it is
 * that token's household (mcp:tools / mcp:resources) or, for a service token (mcp:service), the guest server
 * with the household tools refused by a 403 insufficient_scope step-up challenge.
 */
export async function protectedMcp(req: Request, opts: { path: string; required: boolean }): Promise<Response> {
  const origin = publicOrigin(req);
  const header = req.headers.get("authorization");
  if (!header) {
    if (opts.required) return challenge(origin, opts.path, 401);
    return guest(req);
  }
  const m = /^Bearer\s+([A-Za-z0-9\-._~+/]+=*)$/i.exec(header.trim());
  if (!m) return challenge(origin, opts.path, 401, { code: "invalid_request", description: "Send the token as Authorization: Bearer <token>." });
  let rec: AccessRecord | null;
  try {
    rec = await verifyAccessToken(m[1]!, origin);
  } catch (e) {
    log({ evt: "oauth", step: "mcp", ok: false, error: e instanceof Error ? e.message : String(e) });
    return exposeAuth(withCors(Response.json({ error: "temporarily_unavailable", error_description: "Couldn't check the token just now." }, { status: 503 })));
  }
  if (!rec) return challenge(origin, opts.path, 401, { code: "invalid_token", description: "The access token is invalid or has expired." });

  const need = await needs(req);
  const has = (s: string) => rec!.scope.includes(s);
  if (!rec.home) {
    if (need.household || need.resources) {
      return challenge(origin, opts.path, 403, { code: "insufficient_scope", description: "Service tokens can't reach a household. Sign in as the household.", scope: USER_SCOPES.join(" ") });
    }
    if (!has(SCOPES.service)) return challenge(origin, opts.path, 403, { code: "insufficient_scope", description: "This token has no Lowtide scope.", scope: SCOPES.service });
    return exposeAuth(await guest(req));
  }
  if (need.tools && !has(SCOPES.tools)) return challenge(origin, opts.path, 403, { code: "insufficient_scope", description: "Calling tools needs mcp:tools.", scope: SCOPES.tools });
  if (need.resources && !has(SCOPES.resources)) return challenge(origin, opts.path, 403, { code: "insufficient_scope", description: "Reading the household needs mcp:resources.", scope: SCOPES.resources });
  return exposeAuth(await lowtideHandler(rec.home)(req));
}

/** MCP_AUTH=required makes the plain /api/mcp ask for a token too (the guest is then only the household links). */
export const authRequiredOnGuest = () => process.env.MCP_AUTH === "required";
