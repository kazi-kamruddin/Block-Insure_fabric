import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StatusBadge, resolveStatusTone } from "./status-badge";

it("presents an Oracle referral as a pending routing outcome, not a malfunction", () => {
  expect(resolveStatusTone("ORACLE_FAILED")).toBe("pending");
  const html = renderToStaticMarkup(createElement(StatusBadge, { status: "ORACLE_FAILED" }));
  expect(html).toContain("Oracle did not auto-approve");
  expect(html).toContain("status-oracle_failed");
  expect(html).not.toContain("status-rejected");
});

it("keeps terminal failures in the rejected tone", () => {
  expect(resolveStatusTone("REJECTED")).toBe("rejected");
  expect(resolveStatusTone("PAYMENT_FAILED")).toBe("rejected");
});
