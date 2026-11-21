// Local email connector for the web app's EMAIL_GATEWAY_URL contract.
// POST /send {to, template, variables} -> {messageId}. It relays through the
// Brevo transactional email API. Direct delivery requires explicit opt-in,
// and synthetic recipient domains still require a mapping.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const brevoEndpoint = "https://api.brevo.com/v3/smtp/email";
const maxBodyBytes = 16 * 1024;

const grouped = new Intl.NumberFormat("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (variables) => `${variables.currency || "BDT"} ${grouped.format(Number(variables.amountMinor || 0) / 100)}`;
const words = (value) => String(value || "").replaceAll("_", " ").toLowerCase();
const accountCode = (purpose, v) => ({
  subject: `Your Block-Insure ${purpose} code`,
  text: `Your one-time code is ${v.code}. It expires at ${v.expiresAt}. Do not share it.`,
});

export const templates = {
  "bank-premium-otp": (v) => ({
    subject: "Your Block-Insure premium authorization code",
    text: `Your one-time code is ${v.code}. It authorizes one premium payment for policy ${v.policyId} and expires at ${v.expiresAt}. Do not share it.`,
  }),
  "bank-transaction-status": (v) => ({
    subject: `Bank transaction ${words(v.status)}`,
    text: `${v.method} transfer ${v.transferId} for policy ${v.policyId}: ${money(v)} ${words(v.status)}${v.failureCode ? ` (${words(v.failureCode)})` : ""}.`,
  }),
  "bank-mandate-status": (v) => ({
    subject: `EFT mandate ${words(v.status)}`,
    text: `Your automatic payment mandate ${v.mandateId} for policy ${v.policyId} (${money(v)} per installment) is now ${words(v.status)}.`,
  }),
  "bank-benefit-payment": (v) => ({
    subject: "Benefit payment confirmed",
    text: `Benefit request ${v.benefitRequestId} for policy ${v.policyId} was paid: ${money(v)}.`,
  }),
  "bank-link-status": (v) => ({
    subject: v.status === "LINKED" ? "Bank account linked" : "Bank account link not approved",
    text: v.status === "LINKED"
      ? `Your account ${v.maskedAccount} at ${v.bankId} is now linked to Block-Insure. You can pay premiums from it.`
      : `${v.bankId} did not approve linking account ${v.maskedAccount}. Contact your bank for details.`,
  }),
  "signup-code": (v) => accountCode("sign-up", v),
  "login-code": (v) => accountCode("sign-in", v),
  "signup-existing": () => ({
    subject: "Your Block-Insure account",
    text: "You already have an account with this email address. Sign in with a one-time code instead.",
  }),
  "kyc-approved": (v) => ({
    subject: "Your Block-Insure membership is approved",
    text: `Your profile was approved. Your insurance member ID is ${v.memberId}. Sign in to view your insurance card.`,
  }),
  "kyc-rejected": () => ({
    subject: "Your Block-Insure profile review",
    text: "Your profile was not approved. Contact the insurer for help with your application.",
  }),
};

export function validateConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Email gateway config must be a JSON object");
  if (typeof config.apiKey !== "string" || config.apiKey.trim().length < 20) throw new Error("Email gateway config needs a Brevo apiKey");
  if (!config.sender || typeof config.sender.email !== "string" || !config.sender.email.includes("@")) throw new Error("Email gateway config needs sender.email (a sender verified in Brevo)");
  if (!config.recipients || typeof config.recipients !== "object" || Array.isArray(config.recipients)) throw new Error("Email gateway config needs a recipients map");
  const recipientPolicy = config.recipientPolicy === undefined ? "mapped" : config.recipientPolicy;
  if (recipientPolicy !== "mapped" && recipientPolicy !== "verified-accounts") throw new Error("Email gateway recipientPolicy must be mapped or verified-accounts");
  for (const [demo, real] of Object.entries(config.recipients)) {
    if (typeof real !== "string" || !real.includes("@")) throw new Error(`Recipient mapping for ${demo} must be an email address`);
  }
  return { apiKey: config.apiKey.trim(), sender: { email: config.sender.email, name: config.sender.name || "Block-Insure demo" }, recipients: config.recipients, recipientPolicy };
}

function resolveRecipient(settings, to) {
  const address = typeof to === "string" ? to.trim() : "";
  for (const key of [address.toLowerCase(), address]) {
    if (Object.hasOwn(settings.recipients, key)) return settings.recipients[key];
  }
  if (settings.recipientPolicy !== "verified-accounts") return undefined;
  const email = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
  const nonDeliveryDomain = /\.(?:demo|test|example|invalid|localhost)$/i;
  if (address.length <= 254 && email.test(address) && !nonDeliveryDomain.test(address)) return address;
  return undefined;
}

function tokenMatches(header, token) {
  const supplied = Buffer.from(String(header || "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error("Request body is too large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Request body must be JSON"), { status: 400 }); }
}

export function createGateway({ config, token, fetchImpl = fetch, log = () => {} }) {
  if (typeof token !== "string" || token.length < 32) throw new Error("EMAIL_GATEWAY_TOKEN must contain at least 32 characters");
  const settings = validateConfig(config);
  // Idempotency keys make a retried delivery return the first message ID.
  const delivered = new Map();

  async function send(body, idempotencyKey) {
    if (idempotencyKey && delivered.has(idempotencyKey)) return delivered.get(idempotencyKey);
    if (!Object.hasOwn(templates, body?.template)) throw Object.assign(new Error("Unknown email template"), { status: 422 });
    const render = templates[body.template];
    const to = resolveRecipient(settings, body.to);
    if (!to) throw Object.assign(new Error("Recipient is not allowed by the email gateway policy"), { status: 422 });
    const message = render(body.variables && typeof body.variables === "object" ? body.variables : {});
    let response;
    try {
      response = await fetchImpl(brevoEndpoint, {
        method: "POST",
        headers: { "api-key": settings.apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sender: settings.sender, to: [{ email: to }], subject: message.subject, textContent: message.text }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw Object.assign(new Error("Email provider unavailable"), { status: 502 });
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result.messageId !== "string") {
      throw Object.assign(new Error(`Brevo rejected the message (${response.status})`), { status: 502 });
    }
    const outcome = { messageId: result.messageId };
    if (idempotencyKey) delivered.set(idempotencyKey, outcome);
    log({ template: body.template, messageId: result.messageId });
    return outcome;
  }

  return createServer(async (request, response) => {
    const reply = (status, payload) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    try {
      if (request.method === "GET" && request.url === "/health") return reply(200, { status: "ONLINE", provider: "brevo" });
      if (request.method !== "POST" || request.url !== "/send") return reply(404, { message: "Not found" });
      if (!tokenMatches(request.headers.authorization, token)) return reply(401, { message: "Gateway authentication failed" });
      const key = request.headers["idempotency-key"];
      return reply(200, await send(await readBody(request), typeof key === "string" ? key : ""));
    } catch (error) {
      return reply(error.status ?? 500, { message: error.message ?? "Email delivery failed" });
    }
  });
}
