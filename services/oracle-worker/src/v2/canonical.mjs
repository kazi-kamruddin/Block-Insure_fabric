import { createHash } from "node:crypto";

const quote = value => {
  if (!value.isWellFormed()) throw new TypeError("Canonical strings must contain valid Unicode");
  return JSON.stringify(value).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
};

export function canonical(value) {
  if (typeof value === "string") return quote(value);
  if (Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, canonical).join(",") + "]";
  if (value && typeof value === "object" &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const keys = Object.keys(value).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    return "{" + keys.map(key => quote(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  throw new TypeError("Canonical values require strings, safe integers, arrays, or records");
}

export function canonicalBytes(domain, value) {
  if (typeof domain !== "string" || !domain || domain.includes("\0")) throw new TypeError("Invalid protocol domain");
  return Buffer.from(domain + "\0" + canonical(value), "utf8");
}

export function digest(domain, value) {
  return createHash("sha256").update(canonicalBytes(domain, value)).digest("hex");
}
