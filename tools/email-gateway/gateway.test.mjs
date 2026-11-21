import { test } from "node:test";
import assert from "node:assert/strict";
import { createGateway, templates } from "./gateway.mjs";

const token = "t".repeat(40);
const config = { apiKey: "xkeysib-" + "k".repeat(30), sender: { email: "sender@example.org" }, recipients: { "policyholder1@block-insure.demo": "team@example.org" } };

async function withGateway(fetchImpl, run, overrides = {}) {
  const server = createGateway({ config: { ...config, ...overrides }, token, fetchImpl });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

const post = (base, body, headers = {}) => fetch(`${base}/send`, {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});

test("relays a mapped OTP through Brevo and replays an idempotent retry", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ messageId: "<m1@brevo>" }), { status: 201 }); };
  await withGateway(fetchImpl, async (base) => {
    const body = { to: "policyholder1@block-insure.demo", template: "bank-premium-otp", variables: { code: "123456", policyId: "policy-1", expiresAt: "2026-11-21T10:00:00Z" } };
    const first = await post(base, body, { "idempotency-key": "event-1" });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { messageId: "<m1@brevo>" });
    const again = await post(base, body, { "idempotency-key": "event-1" });
    assert.deepEqual(await again.json(), { messageId: "<m1@brevo>" });
    assert.equal(calls.length, 1);
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(calls[0].url, "https://api.brevo.com/v3/smtp/email");
    assert.deepEqual(sent.to, [{ email: "team@example.org" }]);
    assert.match(sent.textContent, /123456/);
    assert.equal(calls[0].init.headers["api-key"], config.apiKey);
  });
});

test("refuses bad tokens, unmapped recipients and unknown templates", async () => {
  let called = false;
  await withGateway(async () => { called = true; return new Response("{}", { status: 500 }); }, async (base) => {
    const wrongToken = await fetch(`${base}/send`, { method: "POST", headers: { authorization: "Bearer nope" }, body: "{}" });
    assert.equal(wrongToken.status, 401);
    assert.equal((await post(base, { to: "someone@block-insure.demo", template: "bank-premium-otp", variables: {} })).status, 422);
    assert.equal((await post(base, { to: "policyholder1@block-insure.demo", template: "made-up", variables: {} })).status, 422);
    assert.equal((await post(base, { to: "policyholder1@block-insure.demo", template: "bank-link-status", variables: { status: "LINKED" } })).status, 502);
    assert.equal(called, true);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
});

test("renders every template the web app sends", () => {
  for (const name of ["bank-premium-otp", "bank-transaction-status", "bank-mandate-status", "bank-benefit-payment", "bank-link-status"]) {
    const message = templates[name]({ status: "LINKED", amountMinor: 6_400_000, currency: "BDT", method: "EFT", failureCode: "INSUFFICIENT_FUNDS" });
    assert.ok(message.subject && message.text, name);
  }
  assert.match(templates["bank-transaction-status"]({ status: "SETTLED", amountMinor: 6_400_000, currency: "BDT", method: "CLAIM_PAYOUT" }).text, /BDT 64,000\.00/);
  assert.throws(() => createGateway({ config: { ...config, apiKey: "short" }, token }), /Brevo apiKey/);
  assert.throws(() => createGateway({ config, token: "short" }), /EMAIL_GATEWAY_TOKEN/);
});

test("direct delivery is opt-in and mappings override the supplied address", async () => {
  const messages = [];
  const stub = async (_url, init) => {
    messages.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messageId: "<mail@stub>" }), { status: 201 });
  };
  const body = { template: "bank-link-status", variables: { status: "LINKED" } };
  await withGateway(stub, async (base) => {
    assert.equal((await post(base, { ...body, to: "customer@domain.net" })).status, 422);
  });
  await withGateway(stub, async (base) => {
    assert.equal((await post(base, { ...body, to: "customer@domain.net" })).status, 200);
    assert.equal((await post(base, { ...body, to: "POLICYHOLDER1@block-insure.demo" })).status, 200);
    for (const domain of ["app.demo", "local.test", "local.example", "local.invalid", "localhost", "sub.localhost"]) {
      const response = await post(base, { ...body, to: `unmapped@${domain}` });
      assert.equal(response.status, 422);
    }
  }, { recipientPolicy: "verified-accounts" });
  assert.deepEqual(messages.map((message) => message.to[0].email), ["customer@domain.net", "team@example.org"]);
  assert.throws(() => createGateway({ config: { ...config, recipientPolicy: "allow-all" }, token }), /recipientPolicy/);
});

test("onboarding templates send codes and member IDs to the recipient", () => {
  const vars = { code: "1".repeat(6), expiresAt: "2026-11-21T10:00:00Z", memberId: "BI-7K3Q9XMP" };
  for (const name of ["signup-code", "login-code"]) {
    assert.ok(templates[name](vars).text.includes(vars.code));
    assert.ok(templates[name](vars).text.includes(vars.expiresAt));
    assert.ok(!templates[name](vars).subject.includes(vars.code));
  }
  assert.match(templates["signup-existing"]({}).text, /sign in/i);
  assert.ok(templates["kyc-approved"](vars).text.includes(vars.memberId));
  assert.match(templates["kyc-rejected"]({}).text, /not approved/i);
});

test("upstream errors do not echo request details", async () => {
  const marker = "upstream private detail";
  await withGateway(async () => { throw new Error(marker); }, async (base) => {
    const response = await post(base, { to: "policyholder1@block-insure.demo", template: "bank-link-status" });
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes(marker));
  });
});
