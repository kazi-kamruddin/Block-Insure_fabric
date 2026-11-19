export type InvoiceFields = { invoiceNumber: string; serviceDate: string; totalBdt: string };

export function extractInvoiceFields(text: string): InvoiceFields {
  // Only explicit invoice labels yield suggestions. Ignore subtotals and
  // unlabeled numbers, and leave ambiguous dates for the person reading it.
  const invoiceNumber = /^\s*(?:invoice\s*(?:no\.?|number)|invoice\s*#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9/-]{1,47})\s*$/im.exec(text)?.[1] ?? "";
  const date = /^\s*(?:service date|date of service)\s*:?\s*(\d{4}-\d{2}-\d{2})\s*$/im.exec(text)?.[1] ?? "";
  const exactDate = date && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : "";
  const totals = [...text.matchAll(/^\s*(?:grand\s+total|total\s+(?:due|payable)|total)\s*:?\s*(?:BDT|৳)?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*$/gim)];
  const candidates = new Set(totals.map(match => match[1].replaceAll(",", "")));
  return { invoiceNumber, serviceDate: exactDate, totalBdt: candidates.size === 1 ? [...candidates][0] : "" };
}
