import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "./session-token";

const secret = "a-development-secret-with-more-than-32-characters";
const start = Date.UTC(2026, 8, 5);

describe("signed application sessions", () => {
  it("round-trips an unexpired role without exposing the secret", () => {
    const token = createSessionToken(
      { accountId: "policyholder-1", role: "policyholder", subjectId: "policyholder1" },
      secret,
      60,
      start,
    );

    expect(token).not.toContain(secret);
    expect(verifySessionToken(token, secret, start + 30_000)).toMatchObject({
      accountId: "policyholder-1",
      role: "policyholder",
      subjectId: "policyholder1",
    });
  });

  it("rejects tampering and expiration", () => {
    const token = createSessionToken({ accountId: "auditor", role: "auditor" }, secret, 60, start);
    const tampered = `${token.slice(0, -1)}x`;

    expect(verifySessionToken(tampered, secret, start + 1_000)).toBeNull();
    expect(verifySessionToken(token, secret, start + 61_000)).toBeNull();
  });
});
