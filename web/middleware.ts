import { NextResponse, type NextRequest } from "next/server";
import { originAllowed } from "./lib/originguard";

/** Refuses requests that skipped CloudFront (see lib/originguard.ts). */
export function middleware(req: NextRequest) {
  const ok = originAllowed(req.nextUrl.pathname, req.headers.get("x-lowtide-origin"), {
    check: process.env.ORIGIN_CHECK,
    secret: process.env.ORIGIN_SECRET,
  });
  if (ok) return NextResponse.next();
  return new NextResponse(JSON.stringify({ error: "Use the Lowtide site's public address; this one only serves CloudFront." }), {
    status: 403,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const config = {
  runtime: "nodejs",
  matcher: "/:path*",
};
