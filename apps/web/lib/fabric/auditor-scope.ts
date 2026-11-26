import "server-only";

import { ledger } from "./ledger";

const claimAssets = new Set([
  "appeal", "access", "evidence", "evidence-grant", "fraud-assessment",
  "oracle-commitment", "oracle-request", "oracle-result", "privacy-presentation",
  "settlement", "verification",
]);
const relatedAssets = new Set(["claim", "claim-history", "decision", "evidence-batch", "oracle-history", "oracle-snapshot", "policy", "review"]);

export function isAuditorReviewAsset(assetType: string) {
  return claimAssets.has(assetType) || relatedAssets.has(assetType);
}

export async function auditorAssetScope(assetType: string, subjectId: string) {
  const [claims, reviews] = await Promise.all([ledger.listClaims(), ledger.listClaimReviews()]);
  const assigned = new Map(reviews.filter(review => review.assignedAuditorIds.includes(subjectId)).map(review => [review.id, review]));
  const owned = claims.filter(claim => {
    const review = assigned.get(claim.currentReviewId);
    return review?.claimId === claim.id && (!claim.episodeId || review.medicalVersion === claim.version);
  });
  const claimIds = new Set(owned.map(claim => claim.id));
  const reviewIds = new Set(owned.map(claim => claim.currentReviewId));
  const policyIds = new Set(owned.map(claim => claim.policyId));
  const evidenceIds = assetType === "evidence-batch"
    ? new Set((await ledger.listEvidenceReferences()).filter(item => claimIds.has(item.claimId)).map(item => item.id))
    : undefined;
  const snapshotIds = assetType === "oracle-snapshot"
    ? new Set((await ledger.listOracleRequests()).filter(item => claimIds.has(item.claimId)).map(item => item.registrySnapshotId))
    : undefined;

  return function visible(item: unknown, id?: string): unknown | undefined {
    if (assetType === "oracle-history") return id && claimIds.has(id) ? item : undefined;
    if (assetType === "claim-history") return id && claimIds.has(id) ? item : undefined;
    if (!item || typeof item !== "object") return undefined;
    const value = item as Record<string, unknown>;
    const field = (key: string) => typeof value[key] === "string" ? value[key] : "";
    if (assetType === "claim") return claimIds.has(field("id")) ? item : undefined;
    if (assetType === "review") return reviewIds.has(field("id")) ? item : undefined;
    if (assetType === "decision") return reviewIds.has(field("reviewId")) && claimIds.has(field("claimId")) ? item : undefined;
    if (assetType === "policy") return policyIds.has(field("id")) ? item : undefined;
    if (assetType === "oracle-snapshot") return snapshotIds?.has(field("id")) ? item : undefined;
    if (assetType === "evidence-batch" && Array.isArray(value.evidenceIds)) {
      const visibleIds = value.evidenceIds.filter(evidenceId => typeof evidenceId === "string" && evidenceIds?.has(evidenceId));
      return visibleIds.length ? { ...value, evidenceIds: visibleIds } : undefined;
    }
    if (assetType === "evidence-grant" && value.medicalReviewId && !reviewIds.has(field("medicalReviewId"))) return undefined;
    return claimAssets.has(assetType) && claimIds.has(field("claimId")) ? item : undefined;
  };
}
