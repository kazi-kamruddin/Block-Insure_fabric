import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { fabricRoles } from "@/lib/fabric/config";

const sessionPayloadSchema = z.object({
  accountId: z.string().min(1),
  role: z.enum(fabricRoles),
  subjectId: z.string().min(1).optional(),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

export type Session = z.infer<typeof sessionPayloadSchema>;

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(
  identity: Pick<Session, "accountId" | "role" | "subjectId">,
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
) {
  if (secret.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters");
  }
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("SESSION_TTL_SECONDS must be a positive integer");
  }

  const issuedAt = Math.floor(now / 1_000);
  const payload = Buffer.from(
    JSON.stringify({ ...identity, issuedAt, expiresAt: issuedAt + ttlSeconds }),
  ).toString("base64url");

  return `${payload}.${signature(payload, secret)}`;
}

export function verifySessionToken(token: string, secret: string, now = Date.now()): Session | null {
  if (secret.length < 32) return null;

  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;

  const expected = Buffer.from(signature(payload, secret));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  try {
    const parsed = sessionPayloadSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    return parsed.expiresAt > Math.floor(now / 1_000) ? parsed : null;
  } catch {
    return null;
  }
}
