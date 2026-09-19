import { createHash, timingSafeEqual } from "node:crypto";

export function verifyBearerToken(
  authorizationHeader: string | null,
  expectedSecret: string | undefined,
) {
  if (!expectedSecret || expectedSecret.length < 32) return false;
  const match = authorizationHeader?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return false;

  const expectedDigest = createHash("sha256").update(expectedSecret).digest();
  const suppliedDigest = createHash("sha256").update(match[1]).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}
