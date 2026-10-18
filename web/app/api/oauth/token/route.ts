import { errorResponse, json, optionsResponse } from "@/lib/oauth/http";
import { tokenRequest } from "@/lib/oauth/tokens";
import { publicOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(req: Request) {
  try {
    return json(await tokenRequest(req, publicOrigin(req)));
  } catch (e) {
    return errorResponse(e);
  }
}
export const OPTIONS = optionsResponse;
