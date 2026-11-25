import { extractReceiptFields, type ReceiptFields } from "./ocr-fields";

export const medicalOcrEngine = "tesseract-7.0.0:eng-4.0.0-best-int";
const prefix = "/ocr-assets";

async function raster(file: Blob, pageNumber: number) {
  const canvas = document.createElement("canvas");
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isPdf = new TextDecoder().decode(header.slice(0, 5)) === "%PDF-";
  if (isPdf) {
    const pdfjs = await import("pdfjs-dist");
    const assets = new URL(prefix + "/", location.origin).href;
    pdfjs.GlobalWorkerOptions.workerSrc = assets + "pdf.worker.min.mjs";
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), enableXfa: false,
      wasmUrl: assets + "pdf-wasm/", maxImageSize: 4_000_000 });
    try {
      const pdf = await task.promise;
      if (pageNumber > pdf.numPages) throw new Error("That page is outside this PDF.");
      const page = await pdf.getPage(pageNumber);
      const native = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2.4, 1900 / Math.max(native.width, native.height)) });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
    } finally { await task.destroy(); }
  } else {
    const png = header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71;
    const jpeg = header[0] === 255 && header[1] === 216;
    if (!png && !jpeg) throw new Error("Choose a PDF, JPEG or PNG invoice.");
    if (pageNumber !== 1) throw new Error("An image has only one page.");
    const bitmap = await createImageBitmap(new Blob([file], { type: png ? "image/png" : "image/jpeg" }));
    try {
      const scale = Math.min(1, 1900 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.ceil(bitmap.width * scale);
      canvas.height = Math.ceil(bitmap.height * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The browser could not prepare the page.");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } finally { bitmap.close(); }
  }
  return canvas;
}

function checkPage(file: Blob, pageNumber: number) {
  if (file.size < 1 || file.size > 10_485_760 || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 10) {
    throw new Error("Use a file up to 10 MB and a page number from 1 to 10.");
  }
}

function preview(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Source preview failed.")), "image/png"));
}

export async function previewMedicalInvoice(file: Blob, pageNumber: number) {
  checkPage(file, pageNumber);
  return preview(await raster(file, pageNumber));
}

export async function extractMedicalInvoice(file: Blob, pageNumber: number) {
  checkPage(file, pageNumber);
  const canvas = await raster(file, pageNumber);
  const { createWorker } = await import("tesseract.js");
  const assets = new URL(prefix + "/", location.origin).href.replace(/\/$/, "");
  const worker = await createWorker("eng", 1, {
    workerPath: assets + "/worker.min.js", corePath: assets, langPath: assets,
    workerBlobURL: false, cacheMethod: "none",
  });
  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const fields = extractReceiptFields(data.text);
    const lines = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
    const fieldConfidence: Partial<Record<keyof ReceiptFields, number>> = {};
    for (const field of Object.keys(fields) as (keyof ReceiptFields)[]) {
      if (!fields[field]) continue;
      const scores = lines.filter(line => extractReceiptFields(line.text)[field] === fields[field]).map(line => line.confidence);
      if (scores.length) fieldConfidence[field] = Math.min(...scores);
    }
    const lowConfidence = data.confidence < 80 || !fields.invoiceNumber || !fields.serviceDate || !fields.totalBdt ||
      Object.values(fieldConfidence).some(score => score < 80);
    return { fields, confidence: data.confidence, fieldConfidence, lowConfidence, preview: await preview(canvas) };
  } finally { await worker.terminate(); }
}
