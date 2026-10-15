import type { AwsCredentials } from "./sigv4";

/**
 * Which AWS credentials sign a request, in order:
 *  1. a purpose-specific key pair (BEDROCK_*, S3_* or POLLY_* ACCESS_KEY_ID / SECRET_ACCESS_KEY), which is how
 *     the Vercel deployment runs: two single-purpose IAM users, because the organisation denies IAM OIDC providers;
 *  2. the standard AWS environment (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN), which is how
 *     the AWS deployment runs: Lambda puts the execution role's temporary credentials there, so no static key
 *     exists anywhere. Skipped on Vercel, whose runtime variables of that name are not ours.
 */
export type Purpose = "bedrock" | "s3" | "polly";

const PREFIX: Record<Purpose, string> = { bedrock: "BEDROCK", s3: "S3", polly: "POLLY" };

type Env = Record<string, string | undefined>;

export function awsCredentials(purpose: Purpose, env: Env = process.env): AwsCredentials | null {
  const p = PREFIX[purpose];
  const id = env[`${p}_ACCESS_KEY_ID`];
  const secret = env[`${p}_SECRET_ACCESS_KEY`];
  if (id && secret) return { accessKeyId: id, secretAccessKey: secret, sessionToken: env[`${p}_SESSION_TOKEN`] || undefined };
  if (env.VERCEL) return null;
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    return { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN || undefined };
  }
  return null;
}

/** For labels and logs: "role" on Lambda (temporary credentials), "key" for an IAM user's key pair, or null. */
export function credentialKind(purpose: Purpose, env: Env = process.env): "role" | "key" | null {
  const c = awsCredentials(purpose, env);
  if (!c) return null;
  return c.sessionToken ? "role" : "key";
}

/** True inside AWS Lambda (the AWS deployment), false on Vercel and locally. */
export const onLambda = (env: Env = process.env) => Boolean(env.AWS_LAMBDA_FUNCTION_NAME) && !env.VERCEL;
