import { describe, expect, it } from "vitest";
import { verifyBearerToken } from "./bearer-token";

const secret = "event-worker-secret-with-more-than-32-characters";

describe("worker bearer authentication", () => {
  it("accepts only an exact token using the Bearer scheme", () => {
    expect(verifyBearerToken(`Bearer ${secret}`, secret)).toBe(true);
    expect(verifyBearerToken(secret, secret)).toBe(false);
    expect(verifyBearerToken(`Basic ${secret}`, secret)).toBe(false);
    expect(verifyBearerToken(`Bearer ${secret}-wrong`, secret)).toBe(false);
  });

  it("rejects missing and weak configured secrets", () => {
    expect(verifyBearerToken(null, secret)).toBe(false);
    expect(verifyBearerToken("Bearer short", "short")).toBe(false);
    expect(verifyBearerToken("Bearer anything", undefined)).toBe(false);
  });
});
