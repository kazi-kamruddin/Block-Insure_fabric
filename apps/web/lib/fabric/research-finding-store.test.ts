import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { recordResearchFinding } from "./research-finding-store";

it("publishes one immutable versioned finding under competing writes and recovers identical input", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-finding-"));
  const base = { channel: "insurance-medical-reimbursement", chaincode: "insurance-contract", claimId: "synthetic-claim",
    version: 1, basisHash: "a".repeat(64), investigator: "insurer-admin" };
  const proposals = [{ ...base, outcome: "DISMISSED" }, { ...base, outcome: "INCONCLUSIVE" }] as const;
  try {
    const results = await Promise.all(proposals.map(finding => recordResearchFinding(root, finding)));
    const winner = results.findIndex(Boolean);
    expect(winner).not.toBe(-1);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await recordResearchFinding(root, proposals[winner])).toEqual(results[winner]);
    expect(await recordResearchFinding(root, proposals[1 - winner])).toBeNull();
    expect(await recordResearchFinding(root, { ...proposals[1 - winner], version: 2 })).toMatchObject({ version: 2 });
    expect(await readdir(root)).toHaveLength(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
