import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailCodeStore } from "@/lib/auth/email-code";
import { matchesActiveCustomer } from "@/lib/auth/current-session";
import { customerView, CustomerStore, type CustomerRecord } from "./store";
import { memberIdPattern, newMemberId } from "./member-id";
import { nationalIdFields } from "./pii";
import { customerWallet, openCustomerValue, sealCustomerValue } from "./wallet";
import { decideCustomer } from "./onboarding";
import { createCustomerKey, enrollCustomer, registerCustomer } from "@/lib/fabric/ca-client";
import { sendCustomerCode } from "@/lib/auth/customer-auth";
import { deliverBankCommunication } from "@/lib/banking/email-gateway";

const { emailJobs } = vi.hoisted(() => ({ emailJobs: [] as Array<() => Promise<void>> }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", async importOriginal => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: (job: () => Promise<void>) => emailJobs.push(job),
}));
vi.mock("@/lib/banking/email-gateway", () => ({ deliverBankCommunication: vi.fn() }));
vi.mock("@/lib/fabric/ca-client", () => ({
  createCustomerKey: vi.fn(), enrollCustomer: vi.fn(), registerCustomer: vi.fn(),
}));
let root: string;
const zero = 1_800_000_000_000;
const key = Buffer.alloc(32, 11);
const testRoot = path.resolve(import.meta.dirname, "../../../../data/dev-lite/onboarding-20261121/unit");

beforeEach(async () => {
  await mkdir(testRoot, { recursive: true });
  root = await mkdtemp(path.join(testRoot, "customer-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (root && path.dirname(root) === testRoot) await rm(root, { recursive: true, force: true });
});

function customer(index: number, memberId: string): CustomerRecord {
  return { memberId, email: `customer-${index}@block-insure.test`, status: "EMAIL_VERIFIED", createdAt: new Date(zero).toISOString() };
}

async function issue(store: EmailCodeStore, email = "member@block-insure.test", at = zero, ip = "127.0.0.1") {
  const result = await store.issue(email, ip, "signup", at);
  if (!result.code) throw new Error("Challenge was not issued");
  return result.code;
}

describe("customer persistence and custody", () => {
  it("allocates unique IDs compatible with the chaincode ID format", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2048; i++) {
      const id = newMemberId(ids);
      expect(memberIdPattern.test(id) && !ids.has(id)).toBe(true);
      ids.add(id);
    }
  });

  it("serializes concurrent writers and keeps records readable on a rejected write", async () => {
    const stores = [new CustomerStore(root), new CustomerStore(root)];
    const ids = new Set<string>();
    await Promise.all(Array.from({ length: 25 }, (_, i) => stores[i % 2].update(customers => {
      const id = newMemberId(ids);
      ids.add(id);
      customers.push(customer(i, id));
    })));
    await expect(stores[0].update(customers => {
      customers.pop();
      throw new Error("synthetic write failure");
    })).rejects.toThrow("synthetic write failure");
    expect(await stores[1].list()).toHaveLength(25);
  });

  it("stores a keyed NID digest and suffix and omits the digest from responses", async () => {
    const nid = String(100_000_000 + 812);
    const fields = nationalIdFields(nid, key);
    expect(fields.nidHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(fields.nidHmac === nationalIdFields(nid, Buffer.alloc(32, 12)).nidHmac).toBe(false);
    const record = { ...customer(0, newMemberId(new Set())), ...fields };
    const store = new CustomerStore(root);
    await store.update(customers => customers.push(record));
    expect((await readFile(store.file, "utf8")).includes(nid)).toBe(false);
    expect(customerView(record)).not.toHaveProperty("nidHmac");
  });

  it("encrypts wallet values using randomized, member-bound authenticated encryption", () => {
    const context = `${newMemberId(new Set())}:key`;
    const sealed = sealCustomerValue("unit-test value", context, key);
    expect(openCustomerValue(sealed, context, key)).toBe("unit-test value");
    expect(sealCustomerValue("unit-test value", context, key).nonce).not.toBe(sealed.nonce);
    expect(() => openCustomerValue(sealed, context + ":other", key)).toThrow();
    const tag = Buffer.from(sealed.tag, "base64url");
    tag[0] ^= 1;
    expect(() => openCustomerValue({ ...sealed, tag: tag.toString("base64url") }, context, key)).toThrow();
  });

  it("rejects previous session IDs and inactive customer sessions", () => {
    const memberId = newMemberId(new Set());
    const session = { accountId: `customer:${memberId}`, role: "policyholder" as const, subjectId: memberId, sessionId: randomUUID(),
      issuedAt: zero / 1000, expiresAt: zero / 1000 + 3600 };
    const record = { ...customer(0, memberId), status: "ACTIVE" as const, sessionId: session.sessionId };
    expect(matchesActiveCustomer(session, record)).toBe(true);
    expect(matchesActiveCustomer(session, { ...record, sessionId: randomUUID() })).toBe(false);
    expect(matchesActiveCustomer(session, { ...record, status: "SUSPENDED" })).toBe(false);
    expect(matchesActiveCustomer(session, { ...record, status: "PENDING_KYC" })).toBe(false);
    expect(matchesActiveCustomer({ ...session, subjectId: "policyholder1" }, record)).toBe(false);
  });

  it("resumes after a lost register response and then a failed enrollment without changing either credential", async () => {
    vi.stubEnv("DEV_LITE_ONBOARDING", "true");
    vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-dev-lite-190");
    vi.stubEnv("CUSTOMER_STATE_ROOT", root);
    vi.stubEnv("CUSTOMER_WALLET_KEY", key.toString("hex"));
    const memberId = newMemberId(new Set());
    const store = new CustomerStore(root);
    await store.update(customers => customers.push({ ...customer(0, memberId), status: "PENDING_KYC" }));
    const register = vi.mocked(registerCustomer);
    const enroll = vi.mocked(enrollCustomer);
    register.mockImplementationOnce(async () => {
      expect((await store.find(memberId))?.issuance?.phase).toBe("PREPARED");
      throw new Error("synthetic lost registration response");
    }).mockResolvedValueOnce({ status: 409, alreadyRegistered: true });
    vi.mocked(createCustomerKey).mockReturnValue("unit-only private key placeholder");
    enroll.mockImplementationOnce(async () => {
      expect((await store.find(memberId))?.issuance?.phase).toBe("REGISTERED");
      expect((await customerWallet(memberId))?.privateKey.version).toBe(1);
      throw new Error("synthetic interrupted enrollment");
    }).mockResolvedValueOnce({ status: 201, certificate: "unit-only certificate placeholder" });
    const approve = () => decideCustomer(memberId, "approve", "insurerAdmin", "");
    await expect(approve()).rejects.toThrow("synthetic lost registration response");
    await expect(approve()).rejects.toThrow("synthetic interrupted enrollment");
    await expect(approve()).resolves.toMatchObject({ outcome: "ok", changed: true });
    await expect(approve()).resolves.toMatchObject({ outcome: "ok", changed: false });
    expect(register.mock.calls).toHaveLength(2);
    expect(register.mock.calls[0][1] === register.mock.calls[1][1]).toBe(true);
    expect(enroll.mock.calls).toHaveLength(2);
    expect(enroll.mock.calls[0][2] === enroll.mock.calls[1][2]).toBe(true);
    expect(vi.mocked(createCustomerKey)).toHaveBeenCalledTimes(1);
    const active = await store.find(memberId);
    expect(active?.status).toBe("ACTIVE");
    expect(active?.issuance).toBeUndefined();
    expect(active?.certificateIssued).toEqual({ registerHttpStatus: 409, enrollHttpStatus: 201 });
  });
});

describe("passwordless code limits", () => {
  const email = "member@block-insure.test";
  const ip = "127.0.0.1";
  const store = () => new EmailCodeStore("isolated-unit-test-secret-not-production", root);

  it("stores a digest and consumes a correct code once, bound to its purpose", async () => {
    const codes = store();
    const code = await issue(codes);
    const state = JSON.parse(await readFile(path.join(root, "customer-email-codes.json"), "utf8"));
    const persisted = Object.values(state.challenges)[0];
    expect(persisted).toEqual({ digest: expect.stringMatching(/^[a-f0-9]{64}$/), expiresAt: zero + 600_000, attempts: 0 });
    expect(await codes.consume(email, "login", code, zero + 1)).toBe(false);
    expect(await codes.consume(email, "signup", code, zero + 2)).toBe(true);
    expect(await codes.consume(email, "signup", code, zero + 3)).toBe(false);
  });

  it("expires codes at ten minutes and invalidates them on the fifth wrong attempt", async () => {
    const codes = store();
    const initial = await issue(codes);
    expect(await codes.consume(email, "signup", initial, zero + 600_000)).toBe(false);
    const valid = await issue(codes, email, zero + 600_001);
    const wrong = valid === "000000" ? "000001" : "000000";
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(await codes.consume(email, "signup", wrong, zero + 600_002 + attempt)).toBe(false);
    }
    expect(await codes.consume(email, "signup", valid, zero + 600_008)).toBe(false);
  });

  it("shares resend and hourly quotas across code purposes", async () => {
    const codes = store();
    await issue(codes);
    expect(await codes.issue(email, ip, "login", zero + 59_000)).toEqual({ retryAfter: 1 });
    for (let count = 1; count < 5; count++) await issue(codes, email, zero + count * 60_000);
    expect(await codes.issue(email, ip, "login", zero + 300_000)).toEqual({ retryAfter: 3300 });
    expect(Boolean((await codes.issue(email, ip, "login", zero + 3_600_000)).code)).toBe(true);
  });

  it("caps requests from a single source at 60 an hour across distinct addresses", async () => {
    const codes = store();
    for (let count = 0; count < 60; count++) {
      await issue(codes, `member-${count}@block-insure.test`, zero);
    }
    expect(await codes.issue(email, ip, "login", zero)).toEqual({ retryAfter: 3600 });
    expect(Boolean((await codes.issue(email, "127.0.0.2", "login", zero)).code)).toBe(true);
  });

  it("returns the same connector-enabled request response for known and unknown emails", async () => {
    vi.stubEnv("DEV_LITE_ONBOARDING", "true");
    vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-dev-lite-190");
    vi.stubEnv("CUSTOMER_STATE_ROOT", root);
    vi.stubEnv("OTP_SECRET", "isolated-unit-test-secret-not-production");
    vi.stubEnv("EMAIL_GATEWAY_URL", "http://127.0.0.1:3330/send");
    const known = customer(0, newMemberId(new Set()));
    await new CustomerStore(root).update(records => records.push(known));
    const knownResponse = await sendCustomerCode(known.email, "signup");
    const unknownResponse = await sendCustomerCode(email, "signup");
    expect(knownResponse.status).toBe(unknownResponse.status);
    const payload = await knownResponse.json();
    expect(payload).toEqual(await unknownResponse.json());
    expect(payload).not.toHaveProperty("displayCode");
    await Promise.all(emailJobs.splice(0).map(job => job()));
    const templates = vi.mocked(deliverBankCommunication).mock.calls.map(([job]) => job.template);
    expect(templates).toEqual(["signup-existing", "signup-code"]);
  });
});
