import { json, optionsResponse } from "@/lib/oauth/http";
import { serverMetadata } from "@/lib/oauth/config";
import { publicOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 8414 authorization server metadata. The issuer is this origin, so this is the only well-known path. */
export async function GET(req: Request) {
  return json(serverMetadata(publicOrigin(req)), 200, { "cache-control": "public, max-age=300" });
}
export const OPTIONS = optionsResponse;
