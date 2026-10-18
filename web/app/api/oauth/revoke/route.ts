import { errorResponse, json, optionsResponse } from "@/lib/oauth/http";
import { revokeRequest } from "@/lib/oauth/tokens";

export const runtime = "nodejs";
export const maxDuration = 15;

/** RFC 7009: 200 whether or not the token existed. */
export async function POST(req: Request) {
  try {
    await revokeRequest(req);
    return json({});
  } catch (e) {
    return errorResponse(e);
  }
}
export const OPTIONS = optionsResponse;
