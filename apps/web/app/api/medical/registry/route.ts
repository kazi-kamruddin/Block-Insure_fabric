import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { findDemoAccount } from "@/lib/auth/accounts";
import { ledger } from "@/lib/fabric/ledger";
import { ledgerIdSchema as id } from "@/lib/fabric/validation";
import { medicalDevLiteChannel } from "@/lib/fabric/medical-channel";
import { readHospitalRegistrySnapshot, refreshHospitalRegistrySnapshot, registryDigest } from "@/lib/oracle/hospital-registry";
import { buildRegistryManifest, computeHospitalRegistryRoot, type HospitalRegistrySnapshotFile } from "@/lib/oracle/registry-manifest";
import { canonicalProtocolInput } from "@/lib/fabric/canonical-protocol";
import { checkMutationOrigin } from "@/lib/security/request-origin";

const action = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("activate") }),
  z.strictObject({ action: z.literal("propose"), hospitalId: id }),
  z.strictObject({ action: z.literal("attest"), id, rootHash: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  if (process.env.FABRIC_CHANNEL_NAME !== medicalDevLiteChannel) return reply({ message: "Development registry unavailable" }, 404);
  const session = await currentSession().catch(() => null);
  if (session?.role !== "insurerAdmin" && session?.role !== "hospitalOfficer") return reply({ message: "Registry access required" }, 403);
  const query = new URL(request.url).searchParams;
  const manifestId = query.get("manifest");
  const checkHospitalId = query.get("checkSources");
  try {
    if (checkHospitalId !== null) {
      if (session.role !== "insurerAdmin") return reply({ message: "Insurer registry access required" }, 403);
      const hospital = id.safeParse(checkHospitalId);
      if (!hospital.success) return reply({ message: "Enter a valid hospital ID" }, 400);
      const sources = (await ledger.listMedicalOracleSources()).filter(source => source.invoice.hospitalId === hospital.data);
      return reply({ incompleteCount: sources.filter(source => !source.complete).length });
    }
    const snapshots = await ledger.listOracleRegistrySnapshots();
    const scoped = snapshots.filter(item => session.role === "insurerAdmin" || item.hospitalId === session.subjectId);
    if (manifestId === null) return reply({ snapshots: scoped });
    if (session.role !== "hospitalOfficer" || !session.subjectId) return reply({ message: "Hospital registry access required" }, 403);
    const proposal = scoped.find(item => item.id === manifestId);
    if (!proposal) return reply({ message: "No such registry proposal for this hospital" }, 404);
    const preceding = scoped.filter(item => item.attestedAt && item.version < proposal.version)
      .sort((left, right) => right.version - left.version)[0];
    const [snapshot, previousFile, episodes] = await Promise.all([
      readHospitalRegistrySnapshot(proposal.id),
      preceding ? readHospitalRegistrySnapshot(preceding.id).catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }) : null,
      preceding ? ledger.listMedicalEpisodes("insurerAdmin") : [],
    ]);
    if (snapshot.snapshotId !== proposal.id) return reply({ message: "Registry file does not match the proposal ID" }, 409);
    const previous = previousFile && previousFile.snapshotId === preceding.id &&
      await computeHospitalRegistryRoot(previousFile, registryDigest) === preceding.rootHash ? previousFile : null;
    const episodeIds = new Map<string, string>();
    const invoiceIds = new Set([snapshot, previous].filter((file): file is HospitalRegistrySnapshotFile => file !== null)
      .flatMap(file => [...file.records.map(record => record.invoiceId), ...(file.modelContext?.incompleteInvoiceIds ?? [])]));
    for (const episode of episodes.filter(item => item.hospitalId === session.subjectId)) {
      for (let revision = episode.revision; revision > 0; revision--) {
        const invoiceId = registryDigest(canonicalProtocolInput("fabric-medical-episode-revision-v1", episode.id, revision));
        if (invoiceIds.has(invoiceId)) episodeIds.set(invoiceId, episode.id);
      }
    }
    return reply({ manifest: buildRegistryManifest(session.subjectId, snapshot, previous, episodeIds),
      comparisonUnavailable: Boolean(preceding && !previous) });
  } catch {
    return reply({ message: "Registry unavailable" }, 502);
  }
}

export async function POST(request: Request) {
  if (process.env.FABRIC_CHANNEL_NAME !== medicalDevLiteChannel) return reply({ message: "Development registry unavailable" }, 404);
  const origin = checkMutationOrigin(request);
  if (!origin.trusted) return reply({ message: origin.reason }, 403);
  const session = await currentSession().catch(() => null);
  const input = action.safeParse(await request.json().catch(() => null));
  if (!input.success) return reply({ message: "Invalid registry action" }, 400);
  if (!session || session.role !== (input.data.action === "attest" ? "hospitalOfficer" : "insurerAdmin")) {
    return reply({ message: "This role cannot perform that action" }, 403);
  }
  try {
    if (input.data.action === "activate") return reply({ result: await ledger.activateMedicalApprovals() });
    if (input.data.action === "attest") {
      const proposal = await ledger.readOracleRegistrySnapshot(input.data.id);
      if (!session.subjectId || proposal.hospitalId !== session.subjectId) return reply({ message: "Only the assigned hospital can attest this proposal" }, 403);
      const snapshot = await readHospitalRegistrySnapshot(proposal.id);
      const manifest = buildRegistryManifest(session.subjectId, snapshot, null);
      const root = await computeHospitalRegistryRoot(manifest.snapshot, registryDigest);
      if (snapshot.snapshotId !== proposal.id || root !== proposal.rootHash || root !== input.data.rootHash) {
        return reply({ message: "Registry contents do not match the proposal root" }, 409);
      }
      return reply({ result: await ledger.attestMedicalRegistrySnapshot(findDemoAccount(session.accountId)?.fabricUserName, input.data.id, input.data.rootHash) });
    }
    const proposal = await refreshHospitalRegistrySnapshot(input.data.hospitalId);
    return proposal ? reply({ result: { id: proposal.snapshotId, rootHash: proposal.rootHash } })
      : reply({ message: "No linked medical episodes for this hospital" }, 409);
  } catch (error) {
    return reply({ message: error instanceof Error ? error.message.slice(0, 280) : "Registry action did not commit" }, 409);
  }
}
