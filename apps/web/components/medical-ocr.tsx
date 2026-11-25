"use client";

import { useEffect, useState } from "react";
import { extractMedicalInvoice, medicalOcrEngine } from "@/lib/evidence/browser-ocr";
import { sha256Hex } from "@/lib/evidence/browser-crypto";
import type { ReceiptFields } from "@/lib/evidence/ocr-fields";

const labels = { invoiceNumber: "Invoice number", serviceDate: "Documented service date", totalBdt: "Invoice total in BDT", hospital: "Hospital on receipt" } as const;

export function MedicalOCR({ file, evidenceId, accessId = "" }: { file: Blob; evidenceId: string; accessId?: string }) {
  const [page, setPage] = useState("1");
  const [result, setResult] = useState<Awaited<ReturnType<typeof extractMedicalInvoice>> | null>(null);
  const [confirmed, setConfirmed] = useState<ReceiptFields | null>(null);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);

  async function extract() {
    setBusy(true);
    setStatus("Reading the selected page in this browser…");
    setResult(null);
    setConfirmed(null);
    setSource("");
    try {
      const found = await extractMedicalInvoice(file, Number(page));
      setSource(URL.createObjectURL(found.preview));
      setResult(found);
      setConfirmed(found.fields);
      setStatus(found.lowConfidence ? "Some fields are missing or low confidence. Compare them with the source page." : "Compare the suggestions with the source page.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "OCR could not read this document.");
    } finally { setBusy(false); }
  }

  async function save() {
    if (!result || !confirmed || !evidenceId) return;
    setBusy(true);
    try {
      const encoder = new TextEncoder();
      const sourceHash = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
      const nonce = crypto.randomUUID();
      const receipt = { engineVersion: medicalOcrEngine, evidenceId, page: Number(page), sourceHash, nonce,
        lowConfidence: result.lowConfidence, fieldConfidence: result.fieldConfidence, suggestions: result.fields, confirmed };
      const response = await fetch("/api/medical/review", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recordOCR", id: "ocr-" + crypto.randomUUID(), evidenceId, engineVersion: medicalOcrEngine, sourceHash,
          lowConfidence: result.lowConfidence, accessId,
          suggestionsHash: await sha256Hex(encoder.encode(JSON.stringify([nonce, receipt.page, result.fields]))),
          confirmedHash: await sha256Hex(encoder.encode(JSON.stringify([nonce, receipt.page, confirmed]))) }) });
      if (!response.ok) throw new Error((await response.json()).message ?? "Register the original evidence first.");
      const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "ocr-review-" + evidenceId + ".json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setStatus("Confirmation recorded. Keep the downloaded private receipt with your evidence.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "OCR confirmation failed.");
    } finally { setBusy(false); }
  }

  return <section className="medicalSubpanel" style={{ marginTop: 18 }}>
    <h3>Read invoice fields</h3>
    <p className="ocrAdvisory">Browser-local advisory extraction only. Compare the suggestions with the source page; these fields do not change the claim.</p>
    <div className="ocrGrid">
      <div>
        <label>Page<input type="number" min="1" max="10" value={page} disabled={busy} onChange={event => {
          setPage(event.target.value); setResult(null); setConfirmed(null); setSource("");
        }} /></label>
        <div className="medicalButtonGroup">
          <button type="button" className="secondary button" disabled={busy} aria-busy={busy} onClick={extract}>Extract invoice fields</button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- Render a local object URL without sending private image bytes to an optimizer. */}
        {source && <div className="ocrPreviewFrame" style={{ marginTop: 14 }}><img src={source} alt="Selected source invoice page" style={{ maxWidth: "100%", maxHeight: 480, objectFit: "contain" }} /></div>}
      </div>
      {confirmed && result && <div>
        <p className="cardNote">OCR confidence <strong>{Math.round(result.confidence)}%</strong></p>
        {(Object.keys(labels) as (keyof ReceiptFields)[]).map(field => <label key={field}>{labels[field]}
          <input value={confirmed[field] ?? ""} maxLength={80} disabled={busy} spellCheck={false} onChange={event => setConfirmed({ ...confirmed, [field]: event.target.value })} />
        </label>)}
        <div className="medicalButtonGroup">
          <button type="button" className="primary button" disabled={busy || !evidenceId} onClick={save}>Confirm fields and download private receipt</button>
        </div>
      </div>}
    </div>
    <p role="status">{status}</p>
  </section>;
}
