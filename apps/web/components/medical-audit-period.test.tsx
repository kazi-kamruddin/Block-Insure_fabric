import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { MedicalAuditPeriod } from "./medical-audit-period";

it("offers the insurer a per-claim audit resolver in the workspace", () => {
  const html = renderToStaticMarkup(createElement(MedicalAuditPeriod, { organization: "InsurerMSP", canCreate: true }));
  expect(html).toContain("Held claim ID");
  expect(html).toContain("Resolve audit selection");
});

it("keeps the resolver away from seed-share participants who cannot propose periods", () => {
  const html = renderToStaticMarkup(createElement(MedicalAuditPeriod, { organization: "AuditorMSP", canCreate: false }));
  expect(html).not.toContain("Resolve audit selection");
});
