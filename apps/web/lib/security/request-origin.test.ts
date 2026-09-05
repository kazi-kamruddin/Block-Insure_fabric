import { describe, expect, it } from "vitest";
import { checkMutationOrigin } from "./request-origin";

describe("mutation origin guard", () => {
  it("allows same-origin browser and non-browser requests", () => {
    expect(checkMutationOrigin(new Request("http://localhost:3000/api/workflows", {
      headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" },
    })).trusted).toBe(true);
    expect(checkMutationOrigin(new Request("http://localhost:3000/api/workflows"))).toEqual({ trusted: true });
  });

  it("rejects cross-site or mismatched browser requests", () => {
    expect(checkMutationOrigin(new Request("http://localhost:3000/api/workflows", {
      headers: { "sec-fetch-site": "cross-site" },
    })).trusted).toBe(false);
    expect(checkMutationOrigin(new Request("http://localhost:3000/api/workflows", {
      headers: { origin: "https://attacker.example", "sec-fetch-site": "same-site" },
    })).trusted).toBe(false);
  });
});
