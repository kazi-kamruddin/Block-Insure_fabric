import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adultDateOfBirth } from "./age";
import { normalizeMemberReference } from "./member-reference";
import { newMemberId } from "./member-id";
import { CustomerStore, type CustomerRecord } from "./store";
import { decideCustomer, nationalIdHolder } from "./onboarding";
import { saveCustomerWallet, sealCustomerValue } from "./wallet";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/fabric/ca-client", () => ({ createCustomerKey: vi.fn(), enrollCustomer: vi.fn(), registerCustomer: vi.fn() }));

const testRoot = path.resolve(import.meta.dirname, "../../../../data/dev-lite/onboarding-20261121/unit");
const key = Buffer.alloc(32, 7);
let root: string;

beforeEach(async () => {
  await mkdir(testRoot, { recursive: true });
  root = await mkdtemp(path.join(testRoot, "review-"));
  vi.stubEnv("DEV_LITE_ONBOARDING", "true");
  vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-dev-lite-190");
  vi.stubEnv("CUSTOMER_STATE_ROOT", root);
  vi.stubEnv("CUSTOMER_WALLET_KEY", key.toString("hex"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (root && path.dirname(root) === testRoot) await rm(root, { recursive: true, force: true });
});

const person = (memberId: string, status: CustomerRecord["status"], nidHmac = "a".repeat(64)): CustomerRecord =>
  ({ memberId, email: `${memberId.toLowerCase()}@block-insure.test`, status, nidHmac, createdAt: "2026-11-21T00:00:00.000Z" });

describe("member IDs typed at the hospital", () => {
  it("reduce to the issued ID so the Insurer's match works", () => {
    const issued = "BI-7K3Q9XM0";
    for (const typed of ["BI-7K3Q9XM0", "bi-7k3q9xm0", " BI 7K3Q 9XM0 ", "BI7K3Q9XM0", "bi-7k3q9xmo"]) {
      expect(normalizeMemberReference(typed)).toBe(issued);
    }
    expect(normalizeMemberReference("bi-1ll10000")).toBe("BI-11110000");
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    expect(hash(normalizeMemberReference("bi-7k3q9xmo"))).toBe(hash(issued));
  });

  it("leave legacy and unrelated references unchanged", () => {
    expect(normalizeMemberReference(" policyholder1 ")).toBe("policyholder1");
    expect(normalizeMemberReference("BI-123")).toBe("BI-123");
    expect(normalizeMemberReference("BI-UUUUUUUU")).toBe("BI-UUUUUUUU");
  });
});

describe("adult policyholders", () => {
  it("accepts 18 to 100 years old on the business date", () => {
    const today = "2026-11-21";
    expect(adultDateOfBirth("2008-11-21", today)).toBe(true);
    expect(adultDateOfBirth("2008-11-22", today)).toBe(false);
    expect(adultDateOfBirth("1926-11-21", today)).toBe(true);
    expect(adultDateOfBirth("1926-11-20", today)).toBe(false);
  });
});

describe("one person, one customer", () => {
  it("finds a live account that already holds the national ID", () => {
    const pending = person("BI-00000001", "PENDING_KYC");
    expect(nationalIdHolder([pending, person("BI-00000002", "REJECTED")], pending)).toBeUndefined();
    expect(nationalIdHolder([pending, person("BI-00000003", "SUSPENDED")], pending)?.memberId).toBe("BI-00000003");
    expect(nationalIdHolder([pending, person("BI-00000004", "ACTIVE", "b".repeat(64))], pending)).toBeUndefined();
  });

  it("refuses to approve a second account for the same national ID", async () => {
    const store = new CustomerStore(root);
    const [first, second] = [newMemberId(new Set()), newMemberId(new Set())];
    await store.update(customers => customers.push(person(first, "ACTIVE"), person(second, "PENDING_KYC")));
    await expect(decideCustomer(second, "approve", "insurer-admin", "")).resolves.toEqual({ outcome: "duplicate-nid" });
    expect((await store.find(second))?.status).toBe("PENDING_KYC");
    expect((await store.find(second))?.issuance).toBeUndefined();
  });
});

describe("suspension can be reversed", () => {
  it("reactivates a suspended customer who holds a certificate, and nobody else", async () => {
    const store = new CustomerStore(root);
    const [certified, uncertified, active] = [newMemberId(new Set()), newMemberId(new Set()), newMemberId(new Set())];
    await store.update(customers => customers.push(
      { ...person(certified, "SUSPENDED"), nidHmac: "c".repeat(64) },
      { ...person(uncertified, "SUSPENDED"), nidHmac: "d".repeat(64) },
      { ...person(active, "ACTIVE"), nidHmac: "e".repeat(64) },
    ));
    await saveCustomerWallet(certified, { privateKey: sealCustomerValue("unit-only key", `${certified}:key`), certificate: "unit-only certificate" });
    await expect(decideCustomer(certified, "reactivate", "insurer-admin", "")).resolves.toMatchObject({ outcome: "ok", changed: true });
    expect((await store.find(certified))?.status).toBe("ACTIVE");
    expect((await store.find(certified))?.sessionId).toBeUndefined();
    await expect(decideCustomer(uncertified, "reactivate", "insurer-admin", "")).resolves.toEqual({ outcome: "conflict" });
    await expect(decideCustomer(active, "reactivate", "insurer-admin", "")).resolves.toEqual({ outcome: "conflict" });
  });
});
