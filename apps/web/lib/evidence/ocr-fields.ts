export type InvoiceFields = { invoiceNumber: string; serviceDate: string; totalBdt: string };

export function extractInvoiceFields(text: string): InvoiceFields {
  // Only explicit invoice labels yield suggestions. Ignore subtotals and
  // unlabeled numbers, and leave ambiguous dates for the person reading it.
  const invoiceNumber = /^\s*(?:invoice\s*(?:no\.?|number)|invoice\s*#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9/-]{1,47})\s*$/im.exec(text)?.[1] ?? "";
  const date = /^\s*(?:service date|date of service)\s*:?\s*(\d{4}-\d{2}-\d{2})\s*$/im.exec(text)?.[1] ?? "";
  const exactDate = date && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : "";
  // Amounts may be grouped internationally (190,000.00) or in the South Asian
  // lakh style common on Bangladeshi invoices (1,90,000.00).
  const totals = [...text.matchAll(/^\s*(?:grand\s+total|total\s+(?:due|payable)|total)\s*:?\s*(?:BDT|Tk\.?|৳)?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]{1,2}(?:,[0-9]{2})*,[0-9]{3}(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s*$/gim)];
  const candidates = new Set(totals.map(match => match[1].replaceAll(",", "")));
  return { invoiceNumber, serviceDate: exactDate, totalBdt: candidates.size === 1 ? [...candidates][0] : "" };
}
