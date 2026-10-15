import { bedrockReady } from "@/lib/alexa/bedrock";
import { credentialKind, onLambda } from "@/lib/aws/credentials";
import { pollyReady } from "@/lib/aws/polly";
import { hasStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health: what this deployment runs on, without calling anything (it is also the Lambda Web Adapter's
 * readiness check, so it must answer fast). Names services and credential kinds only, never a key.
 */
export function GET() {
  return Response.json(
    {
      ok: true,
      host: onLambda() ? "aws-lambda" : process.env.VERCEL ? "vercel" : "local",
      region: process.env.AWS_REGION ?? null,
      bedrock: bedrockReady() ? credentialKind("bedrock") : null,
      polly: pollyReady() ? credentialKind("polly") : null,
      store: hasStorage() ? (process.env.S3_BUCKET ? "s3" : "other") : "files",
      s3: process.env.S3_BUCKET ? credentialKind("s3") : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
