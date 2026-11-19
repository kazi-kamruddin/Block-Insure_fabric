import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { researchFindings } from "./research-finding";

type Finding = {
  channel: string;
  chaincode: string;
  claimId: string;
  version: number;
  outcome: keyof typeof researchFindings;
  basisHash: string;
  investigator: string;
};

export async function recordResearchFinding(root: string, finding: Finding) {
  const key = createHash("sha256").update(JSON.stringify([finding.channel, finding.chaincode, finding.claimId, finding.version])).digest("hex");
  const file = path.join(root, key + ".json");
  const temp = path.join(root, key + "-" + randomUUID() + ".tmp");
  const stored = { ...finding, kind: "INSURER_INVESTIGATION_FINDING_V1", recordedAt: new Date().toISOString() };
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temp, JSON.stringify(stored) + "\n", { mode: 0o600, flag: "wx", flush: true });
    await link(temp, file);
    return { outcome: stored.outcome, version: stored.version, recordedAt: stored.recordedAt };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const prior = JSON.parse(await readFile(file, "utf8")) as typeof stored;
    if (prior.kind !== stored.kind || !Object.entries(finding).every(([k, v]) => prior[k as keyof Finding] === v)) return null;
    return { outcome: prior.outcome, version: prior.version, recordedAt: prior.recordedAt };
  } finally {
    await unlink(temp).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}
