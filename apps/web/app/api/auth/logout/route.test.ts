import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { currentSession } from "@/lib/auth/current-session";
import { createSessionToken } from "@/lib/auth/session-token";
import { CustomerStore } from "@/lib/customers/store";
import { POST } from "./route";

const { cookie } = vi.hoisted(() => ({ cookie: { value: undefined as string | undefined } }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: () => cookie.value ? { value: cookie.value } : undefined,
  delete: () => { cookie.value = undefined; },
}) }));

const secret = "synthetic-session-secret-for-tests-only";
const identity = { accountId: "insurer-admin", role: "insurerAdmin", subjectId: "insurerAdmin" } as const;
const locations: string[] = [];
const request = () => new Request("http://127.0.0.1:3219/api/auth/logout", { method: "POST" });
async function configure() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fabric-logout-test-"));
  locations.push(directory);
  await mkdir(path.join(directory, "otp"));
  vi.stubEnv("OTP_STATE_ROOT", path.join(directory, "otp"));
  vi.stubEnv("AUTH_SECRET", secret);
  vi.stubEnv("CUSTOMER_STATE_ROOT", directory);
  vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-dev-lite-190");
  vi.stubEnv("DEV_LITE_ONBOARDING", "true");
}
afterEach(async () => {
  cookie.value = undefined;
  vi.unstubAllEnvs();
  for (const location of locations.splice(0)) await rm(location, { recursive: true, force: true });
});

it("revokes a signed staff cookie without revoking a different staff session", async () => {
  await configure();
  const first = createSessionToken({ ...identity, sessionId: "00000000-0000-4000-8000-000000000001" }, secret, 60);
  cookie.value = first;
  expect(await currentSession()).toMatchObject(identity);
  expect((await POST(request())).status).toBe(200);
  expect(cookie.value).toBeUndefined();
  cookie.value = first;
  expect(await currentSession()).toBeNull();
  cookie.value = createSessionToken({ ...identity, sessionId: "00000000-0000-4000-8000-000000000002" }, secret, 60);
  expect(await currentSession()).toMatchObject(identity);
});

it("deletes the active onboarded customer's server-side session and rejects replay", async () => {
  await configure();
  const memberId = "BI-00000001";
  const sessionId = "00000000-0000-4000-8000-000000000001";
  const store = new CustomerStore();
  await store.update(records => records.push({ memberId, sessionId, email: "member@example.invalid", status: "ACTIVE", createdAt: "2026-11-25T00:00:00Z" }));
  const token = createSessionToken({ role: "policyholder", accountId: `customer:${memberId}`, subjectId: memberId, sessionId }, secret, 60);
  cookie.value = token;
  expect(await currentSession()).toMatchObject({ sessionId });
  expect((await POST(request())).status).toBe(200);
  expect((await store.find(memberId))?.sessionId).toBeUndefined();
  cookie.value = token;
  expect(await currentSession()).toBeNull();
});
