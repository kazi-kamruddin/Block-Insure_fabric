import { describe, expect, it } from "vitest";
import { roleOperations } from "@/components/guided-workflow-form";
import type { FabricRole } from "@/lib/fabric/config";
import { findSection, overviewSection, sectionForOperation, sectionHref, sectionsFor, workspaceSections } from "./sections";

const roles = Object.keys(workspaceSections) as FabricRole[];

describe("workspace sub-pages", () => {
  it("give every operation a role can perform exactly one owning page", () => {
    for (const role of roles) {
      for (const medical of [false, true]) {
        for (const operation of roleOperations(role, medical, true)) {
          const owners = workspaceSections[role].filter((section) => section.operations?.includes(operation));
          expect(owners.map((section) => section.id), `${role} ${operation}`).toHaveLength(1);
        }
      }
    }
  });

  it("start every workspace at its overview and keep page ids unique", () => {
    for (const role of roles) {
      const ids = workspaceSections[role].map((section) => section.id);
      expect(ids[0]).toBe(overviewSection);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("hide channel- and onboarding-specific pages when they do not apply", () => {
    expect(findSection("hospitalOfficer", "registry", { medical: false, onboarding: true })).toBeUndefined();
    expect(findSection("hospitalOfficer", "registry", { medical: true, onboarding: true })?.id).toBe("registry");
    expect(sectionsFor("policyholder", { medical: true, onboarding: false }).some((section) => section.id === "profile")).toBe(false);
    expect(findSection("auditor", null, { medical: true, onboarding: true })?.id).toBe(overviewSection);
  });

  it("route prepared operations and build page addresses", () => {
    expect(sectionForOperation("insurerAdmin", "authorizeSettlement")?.id).toBe("claims");
    expect(sectionForOperation("bankOfficer", "confirmSettlement")?.id).toBe("payouts");
    expect(sectionForOperation("policyholder", "unknownOperation")).toBeUndefined();
    expect(sectionHref("insurer", overviewSection)).toBe("/workspace/insurer");
    expect(sectionHref("insurer", "claims")).toBe("/workspace/insurer/claims");
  });
});
