import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ReceiptReviewTable } from "./receipt-review";

it("shows the claimant edit, OCR confidence, and episode discrepancy", () => {
  const html = renderToStaticMarkup(createElement(ReceiptReviewTable, {
    suggestions: { totalBdt: "85000", invoiceNumber: "ABC123", serviceDate: "2026-11-24" },
    confirmed: { totalBdt: "95000", invoiceNumber: "ABC123", serviceDate: "2026-11-24" },
    confidence: { totalBdt: 71 },
    facts: { billedMinor: 8500000, serviceDate: "2026-11-24" },
  }));
  expect(html).toContain("85000");
  expect(html).toContain("95000");
  expect(html).toContain("71%");
  expect(html).toContain("Edited by claimant");
  expect(html).toContain("Differs from episode");
});
