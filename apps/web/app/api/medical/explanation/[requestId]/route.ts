import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";
import { oracleWorkerStateRoot } from "@/lib/oracle/health";
import { verifyExplanation, type ExplanationReceipt } from "@/lib/oracle/explanation-receipt";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const session = await currentSession().catch(() => null);
  if (!session || !["insurerAdmin", "policyholder", "auditor"].includes(session.role)) {
    return reply({ message: "Medical case access required" }, 403);
  }
  const { requestId } = await params;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(requestId)) return reply({ message: "Invalid Oracle request ID" }, 400);
  try {
    const request = await ledger.readOracleRequest(requestId);
    const claim = await ledger.readClaim(request.claimId);
    if (!claim.episodeId || (session.role === "policyholder" && claim.claimantId !== session.subjectId)) {
      return reply({ message: "Medical case access required" }, 403);
    }
    if (session.role === "auditor") {
      const review = claim.currentReviewId ? await ledger.readClaimReview(claim.currentReviewId).catch(() => null) : null;
      if (!review || review.medicalVersion !== request.claimVersion || !review.assignedAuditorIds.includes(session.subjectId ?? "")) {
        return reply({ message: "Medical case access required" }, 403);
      }
    }
    const oracleIds = [...new Set(request.assignedOracleIds)].filter(id => /^oracle[123]$/.test(id));
    const matched = request.finalizedAt && request.resultHash ? await Promise.all(oracleIds.map(async oracleId => {
      const result = await ledger.readOracleResult(`${requestId}:${oracleId}`).catch(() => null);
      if (!result || result.requestId !== requestId || result.oracleId !== oracleId ||
          result.resultHash !== request.resultHash || result.claimVersion !== request.claimVersion) return null;
      try {
        const filename = path.join(oracleWorkerStateRoot(), "receipts", requestId, `${oracleId}.json`);
        const receipt = JSON.parse(await fs.readFile(filename, "utf8")) as ExplanationReceipt;
        return receipt.requestId === requestId && receipt.oracleId === oracleId ? { result, receipt } : null;
      } catch {
        return null;
      }
    })) : [];
    const available = matched.filter(item => item !== null);
    return reply(verifyExplanation(available.map(item => item.receipt), available.map(item => item.result), request.modelHash));
  } catch {
    return reply({ message: "Oracle explanation unavailable" }, 404);
  }
}
