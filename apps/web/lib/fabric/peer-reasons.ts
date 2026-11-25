import { randomUUID } from "node:crypto";

const exactReasons = new Set([
  "only APPEAL_DOCUMENT evidence may be added after rejection",
  "a settlement is already authorized for this claim; complete or reconcile it before correcting",
]);
const allowedPatterns = [
  /^auditor[1-4] must confirm decryption of [A-Za-z0-9._-]{1,128}$/,
  /^private medicalOracleBenchmark [a-f0-9]{64} already exists$/,
  /^(?:bankTransfer|premiumPayment|evidenceReference|claim|policy|claimReview|oracleRequest) [A-Za-z0-9._-]{1,128} does not exist$/,
  /^coverage cannot start before the ledger business date \d{4}-\d{2}-\d{2}; medical cover is never backdated$/,
];
const classifiedErrors = new WeakSet<Error>();

function redactSecrets(text: string) {
  const values = Object.entries(process.env).flatMap(([key, value]) =>
    /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)/i.test(key) && value && value.length >= 6 ? [value] : [],
  ).sort((left, right) => right.length - left.length);
  for (const value of values) text = text.replaceAll(value, "[redacted]");
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[private key redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:otp|code)\s*[:=]?\s*\d{6}\b/gi, "[code redacted]");
}

export function withPeerReasons(error: unknown) {
  if (!(error instanceof Error)) return error;
  const details = (error as Error & { details?: unknown }).details;
  if (!Array.isArray(details) || classifiedErrors.has(error)) return error;
  const messages = details.flatMap(detail => typeof detail?.message === "string" ? [detail.message] : []);
  const allowed = [...new Set(messages.map(message => message.replace(/^chaincode response \d+,\s*/, "").trim())
    .filter(message => exactReasons.has(message) || allowedPatterns.some(pattern => pattern.test(message))))];
  if (allowed.length) {
    error.message = allowed.join(". ");
  } else {
    const reference = randomUUID();
    console.error("Ledger rejected request", { reference, error: redactSecrets(error.message), details: messages.map(redactSecrets) });
    error.message = `Ledger rejected the request (ref ${reference})`;
  }
  classifiedErrors.add(error);
  return error;
}
