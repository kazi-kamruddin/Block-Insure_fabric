import "server-only";
import { setTimeout } from "node:timers/promises";
import { medicalDevLiteChannel } from "@/lib/fabric/medical-channel";

export function medicalSourcePublisherEnabled() {
  return process.env.FABRIC_CHANNEL_NAME === medicalDevLiteChannel && process.env.FABRIC_MEDICAL_SOURCE_PUBLISHER === "true";
}

export type PublishedSourcePin = { issuerId: string; feedVersion: number; root: string };
const issuerPorts: Record<string, number> = { "S-A": 3421, "S-B": 3422, "S-C": 3423 };
const publicationMessages: Record<string, string> = {
  PUBLISHER_MEMORY_FLOOR: "Source publication needs at least 700 MB available on the host.",
  CLAIM_VERSION_CHANGED: "The claim version changed. Refresh the workspace and try again.",
  UNSUPPORTED_HOSPITAL_OR_SERVICE: "This publisher serves diagnostic invoices from Hospital 2.",
  RETAINED_FEEDS_UNAVAILABLE: "The publisher could not read the retained source feeds.",
  FEED_ANCHOR_MISMATCH: "The signed feed and ledger anchor differ. Check the source publisher status.",
  FEED_CLOCK_NOT_READY: "The source feed clock is behind its coverage or previous issue time.",
  RECEIPT_SOURCE_LINK_INVALID: "The recorded receipt is not linked to this version of the Hospital invoice.",
  HISTORICAL_SOURCE_REQUIRES_MANUAL_PROCESSING: "This claim already has historical source records.",
};

export async function publishMedicalClaimSources(claimId: string, claimVersion: number): Promise<PublishedSourcePin[]> {
  const token = process.env.ORACLE_REGISTRY_API_TOKEN;
  if (!token) throw new Error("The local medical source publisher is not configured.");
  let response: Response;
  try {
    response = await fetch("http://127.0.0.1:3411/publish-medical", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ claimId, claimVersion }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw new Error("The local medical source publisher was not reachable.");
  }
  const result = await response.json().catch(() => null) as { claimVersion?: number; pins?: PublishedSourcePin[]; code?: string } | null;
  if (!response.ok) {
    const message = result?.code && publicationMessages[result.code];
    throw new Error(message || "Verify that Hospital 2 has recorded the invoice reference and that the source publisher is healthy.");
  }
  const pins = result?.pins;
  if (result?.claimVersion !== claimVersion || pins?.length !== 3 ||
      new Set(pins.map(pin => pin.issuerId)).size !== 3 || pins.some(pin => !Object.hasOwn(issuerPorts, pin.issuerId) ||
        !/^[a-f0-9]{64}$/.test(pin.root) || !Number.isSafeInteger(pin.feedVersion) || pin.feedVersion < 1)) {
    throw new Error("The source publisher did not confirm all three source anchors.");
  }

  // A 15-second commit window leaves little room for an out-of-date mirror.
  // Check each adapter before the request starts its ledger clock.
  for (let attempt = 0; attempt < 6; attempt++) {
    const available = await Promise.all(pins.map(async pin => {
      try {
        const mirror = await fetch(`http://127.0.0.1:${issuerPorts[pin.issuerId]}/health`, {
          cache: "no-store", redirect: "error", signal: AbortSignal.timeout(1_000),
        });
        return mirror.ok && (await mirror.json()).feedVersion >= pin.feedVersion;
      } catch { return false; }
    }));
    if (available.every(Boolean)) return pins.toSorted((left, right) => left.issuerId.localeCompare(right.issuerId, "en"));
    if (attempt < 5) await setTimeout(500);
  }
  throw new Error("The source mirror has not reached the anchored versions. Refresh the workspace and try again.");
}
