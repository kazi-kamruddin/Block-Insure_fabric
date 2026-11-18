"use client";

import { useEffect, useState } from "react";
import { extractMedicalInvoice, medicalOcrEngine } from "@/lib/evidence/browser-ocr";
import { sha256Hex } from "@/lib/evidence/browser-crypto";
import type { InvoiceFields } from "@/lib/evidence/ocr-fields";

const labels = { invoiceNumber: "Invoice number", serviceDate: "Documented service date", totalBdt: "Invoice total in BDT" } as const;

export function MedicalOCR({ file, evidenceId, accessId = "" }: { file: Blob; evidenceId: string; accessId?: string }) {
  const [page, setPage] = useState("1");
  const [result, setResult] = useState<Awaited<ReturnType<typeof extractMedicalInvoice>> | null>(null);
  const [confirmed, setConfirmed] = useState<InvoiceFields | null>(null);
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
        lowConfidence: result.lowConfidence, suggestions: result.fields, confirmed };
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

  return <section>
    <h3>Read invoice fields</h3>
    <p>Compare the suggestions with the source page. These fields do not change the claim.</p>
    <label>Page<input type="number" min="1" max="10" value={page} disabled={busy} onChange={event => {
      setPage(event.target.value); setResult(null); setConfirmed(null); setSource("");
    }} /></label>
    <button type="button" className="secondary button" disabled={busy} onClick={extract}>Extract invoice fields</button>
    {/* eslint-disable-next-line @next/next/no-img-element -- Render a local object URL without sending private image bytes to an optimizer. */}
    {source && <img src={source} alt="Selected source invoice page" style={{ maxWidth: "100%", maxHeight: 480, objectFit: "contain" }} />}
    {confirmed && result && <>
      <p>OCR confidence {Math.round(result.confidence)}%</p>
      {(Object.keys(labels) as (keyof InvoiceFields)[]).map(field => <label key={field}>{labels[field]}
        <input value={confirmed[field]} maxLength={80} disabled={busy} onChange={event => setConfirmed({ ...confirmed, [field]: event.target.value })} />
      </label>)}
      <button type="button" className="secondary button" disabled={busy || !evidenceId} onClick={save}>Confirm fields and download private receipt</button>
    </>}
    <p role="status">{status}</p>
  </section>;
}
