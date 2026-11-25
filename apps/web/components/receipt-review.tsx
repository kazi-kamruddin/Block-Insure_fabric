"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { previewMedicalInvoice } from "@/lib/evidence/browser-ocr";
import { sha256Hex } from "@/lib/evidence/browser-crypto";
import type { ReceiptFields } from "@/lib/evidence/ocr-fields";

export type ReceiptEpisodeFacts = { billedMinor: number; serviceDate: string; hospital?: string; invoiceNumber?: string };
type Confidence = Partial<Record<keyof ReceiptFields, number>>;
const labels = { invoiceNumber: "Invoice or receipt number", serviceDate: "Service date", totalBdt: "Invoice total (BDT)", hospital: "Hospital" } as const;
const fields = z.object({ invoiceNumber: z.string().max(100), serviceDate: z.string().max(100), totalBdt: z.string().max(100),
  hospital: z.string().max(100).optional() });
const receiptSchema = z.object({
  evidenceId: z.string().min(1), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), page: z.number().int().min(1).max(10),
  suggestions: fields, confirmed: fields, fieldConfidence: z.partialRecord(z.enum(["invoiceNumber", "serviceDate", "totalBdt", "hospital"]), z.number().min(0).max(100)).optional(),
});
const keys = Object.keys(labels) as (keyof ReceiptFields)[];

function amountMinor(value: string) {
  const formatted = value.replaceAll(",", "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(formatted)) return null;
  const [whole, fraction = ""] = formatted.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

export function ReceiptReviewTable({ suggestions, confirmed, confidence, facts }: {
  suggestions: ReceiptFields; confirmed: ReceiptFields; confidence?: Confidence; facts?: ReceiptEpisodeFacts;
}) {
  const episode = facts ? { serviceDate: facts.serviceDate, totalBdt: String(facts.billedMinor / 100),
    hospital: facts.hospital, invoiceNumber: facts.invoiceNumber } : null;
  return <table>
    <thead><tr><th scope="col">Field</th><th scope="col">OCR extraction</th><th scope="col">Claimant confirmation</th>
      <th scope="col">Confidence</th><th scope="col">Episode comparison</th></tr></thead>
    <tbody>{keys.map(key => {
      const expected = episode?.[key];
      const actual = confirmed[key]?.trim();
      const score = confidence?.[key];
      const differs = Boolean(expected && actual && (key === "totalBdt" ? amountMinor(actual) !== facts?.billedMinor :
        actual.toLowerCase() !== expected.trim().toLowerCase()));
      const edited = (suggestions[key] ?? "") !== (confirmed[key] ?? "");
      return <tr key={key}><th scope="row">{labels[key]}</th><td>{suggestions[key] || "—"}</td>
        <td>{actual || "—"}{edited && <small> · Edited by claimant</small>}</td>
        <td>{score === undefined ? "Unavailable" : `${Math.round(score)}%`}{score !== undefined && score < 80 && <strong> · Low confidence</strong>}</td>
        <td>{expected ? <>{expected}{differs && <strong className="evidenceWarning"> · Differs from episode</strong>}</> : "No episode field"}</td>
      </tr>;
    })}</tbody>
  </table>;
}

export function ReceiptReview({ file, evidenceId, facts }: { file: Blob; evidenceId: string; facts?: ReceiptEpisodeFacts }) {
  const [review, setReview] = useState<{ receipt: z.infer<typeof receiptSchema>; url: string }>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (review) URL.revokeObjectURL(review.url); }, [review]);

  async function load(input: File) {
    setReview(undefined);
    setStatus("");
    setBusy(true);
    try {
      if (input.size > 64_000) throw new Error("Choose an OCR receipt under 64 KB.");
      const receipt = receiptSchema.parse(JSON.parse(await input.text()));
      const sourceHash = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
      if (receipt.evidenceId !== evidenceId || receipt.sourceHash !== sourceHash) throw new Error("This receipt refers to a different evidence document.");
      setReview({ receipt, url: URL.createObjectURL(await previewMedicalInvoice(file, receipt.page)) });
    } catch (error) {
      setStatus(error instanceof z.ZodError || error instanceof SyntaxError ? "Invalid OCR receipt." :
        error instanceof Error ? error.message : "Receipt unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="medicalSubpanel" aria-label="Claimant OCR receipt">
    <h3>Claimant OCR receipt</h3>
    <label>Open the claimant’s private OCR receipt<input type="file" accept="application/json,.json" disabled={busy}
      onChange={event => { const input = event.target.files?.[0]; if (input) void load(input); }} /></label>
    {status && <p role="status">{status}</p>}
    {review && <>
      <p>Claimant-supplied OCR fields. The source file hash matches this evidence.</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- Keep the private evidence page in the browser. */}
      <div className="ocrPreviewFrame"><img src={review.url} alt="Original receipt page" style={{ maxWidth: "100%", maxHeight: 480 }} /></div>
      <div style={{ overflowX: "auto" }}><ReceiptReviewTable {...review.receipt} confidence={review.receipt.fieldConfidence} facts={facts} /></div>
    </>}
  </section>;
}
