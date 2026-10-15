import { signRequest } from "../aws/sigv4";

/**
 * SigV4 headers for one JSON POST to Bedrock Runtime. Signed IAM requests rather than a Bedrock API key, because
 * the organisation denies bedrock:CallWithBearerToken. With temporary credentials (the Lambda execution role)
 * pass the session token; it is sent and signed as x-amz-security-token.
 */
export function sigv4Headers(url: string, body: string, region: string, keyId: string, secret: string, now = new Date(), sessionToken?: string): Record<string, string> {
  return signRequest(
    { method: "POST", url, service: "bedrock", region, body, headers: { "content-type": "application/json" }, now },
    { accessKeyId: keyId, secretAccessKey: secret, sessionToken },
  );
}
