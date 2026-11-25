import { EndorseError } from "@hyperledger/fabric-gateway";
import { afterEach, expect, it, vi } from "vitest";
import { withPeerReasons } from "./peer-reasons";

const failure = (message: string) => new EndorseError({
  code: 10, transactionId: "synthetic-rejected-tx", cause: new Error("endorsement failed") as never,
  details: [{ address: "peer.internal", mspId: "InsurerMSP", message }],
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("passes through only known chaincode reasons and preserves the SDK error type", () => {
  const error = failure("chaincode response 500, auditor4 must confirm decryption of evidence-1");
  expect(withPeerReasons(error)).toBe(error);
  expect(error.message).toBe("auditor4 must confirm decryption of evidence-1");
});

it("replaces unknown details with a reference and redacts credentials from the correlated log", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = failure("unexpected peer-only information; bearer synthetic-private-credential");
  withPeerReasons(error);
  expect(error.message).toMatch(/^Ledger rejected the request \(ref [0-9a-f-]+\)$/);
  expect(log).toHaveBeenCalledWith("Ledger rejected request", expect.objectContaining({
    reference: error.message.match(/ref ([^)]+)/)?.[1],
    details: ["unexpected peer-only information; Bearer [redacted]"],
  }));
});
