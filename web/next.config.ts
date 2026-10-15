import type { NextConfig } from "next";
import path from "node:path";

/**
 * Two deployments from one codebase:
 *  - AWS (the canonical one): `NEXT_OUTPUT=standalone next build`, served by AWS Lambda through the Lambda Web
 *    Adapter behind CloudFront (infra/deploy.py). Lambda's file system is read-only outside /tmp, so Next's ISR
 *    and fetch cache live in memory (cache-handler.cjs), and images are served as they are (no sharp binary).
 *  - Vercel (the original): the default build. Once AWS is live, AWS_CANONICAL_URL on the Vercel project sends
 *    every page there; /api/* keeps answering so MCP links already pasted into assistants keep working.
 */
const standalone = process.env.NEXT_OUTPUT === "standalone";
const canonical = process.env.AWS_CANONICAL_URL?.replace(/\/$/, "");

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: path.join(process.cwd()),
  ...(standalone
    ? {
        output: "standalone" as const,
        cacheHandler: path.join(process.cwd(), "cache-handler.cjs"),
        cacheMaxMemorySize: 0,
        images: { unoptimized: true },
        outputFileTracingExcludes: { "*": ["node_modules/sharp/**", "node_modules/@img/**", "node_modules/@esbuild/**", "node_modules/esbuild/**", "node_modules/typescript/**"] },
      }
    : {}),
  async redirects() {
    if (!canonical) return [];
    return [
      { source: "/", destination: `${canonical}/`, permanent: false },
      { source: "/:path((?!api/).+)", destination: `${canonical}/:path`, permanent: false },
    ];
  },
};

export default config;
