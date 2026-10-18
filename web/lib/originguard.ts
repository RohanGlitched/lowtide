import { timingSafeEqual } from "node:crypto";

/**
 * On AWS the function sits behind CloudFront, which adds a secret header (x-lowtide-origin, a NoEcho stack
 * parameter that infra/deploy.py generates once and keeps). With ORIGIN_CHECK=on, any request without it is
 * refused, so the Lambda Function URL can't be used to go around CloudFront (its caching, its /events block and
 * its security headers). Two paths stay open inside the function:
 *  - /events, the Lambda Web Adapter's pass-through for EventBridge Scheduler: the adapter calls it on loopback,
 *    with no CloudFront in between, and the route itself accepts only an event carrying this deploy's token;
 *  - nothing else. The adapter's readiness check gets a 403 too, which it counts as "up" (only 5xx is unhealthy).
 */
export function originAllowed(path: string, header: string | null, env: { check?: string; secret?: string }): boolean {
  if (env.check !== "on" || !env.secret || env.secret.length < 16) return true;
  if (path === "/events") return true;
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(env.secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
