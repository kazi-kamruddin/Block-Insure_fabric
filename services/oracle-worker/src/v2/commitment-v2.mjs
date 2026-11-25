import { digest } from "./canonical.mjs";
import { identifier, sha256Hex } from "./fact-vector.mjs";

const decisions = new Set(["AUTO_APPROVE", "PANEL_REVIEW", "INTEGRITY_FAIL"]);

export function commitmentHash({ channelId, requestId, claimVersion, oracleSubject, factVectorHash, decision, salt }) {
  if (![channelId, requestId, oracleSubject].every(id => typeof id === "string" && identifier.test(id)) ||
      !Number.isSafeInteger(claimVersion) || claimVersion < 1 || !sha256Hex.test(factVectorHash) ||
      !decisions.has(decision) || !sha256Hex.test(salt)) throw new TypeError("Invalid Oracle v2 commitment input");
  return digest("oracle-v2:commit", [channelId, requestId, claimVersion, oracleSubject, factVectorHash, decision, salt]);
}
