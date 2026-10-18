import { json, optionsResponse } from "@/lib/oauth/http";
import { ACCOUNT_PATH, MCP_PATH, resourceMetadata } from "@/lib/oauth/config";
import { publicOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 9728 protected resource metadata, at the root and with the resource path inserted
 * (/.well-known/oauth-protected-resource/api/mcp and .../api/mcp/account).
 */
export async function GET(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const suffix = path.length ? `/${path.join("/")}`.replace(/\/$/, "") : "";
  if (suffix && suffix !== MCP_PATH && suffix !== ACCOUNT_PATH) return json({ error: "not_found" }, 404);
  return json(resourceMetadata(publicOrigin(req), suffix), 200, { "cache-control": "public, max-age=300" });
}
export const OPTIONS = optionsResponse;
