// Browser-safe member ID helpers (no Node imports): hospital forms hash the
// member ID in the browser, so a clerk's typing must reduce to the exact ID
// the Insurer issued before it is hashed.
export const memberIdPattern = /^BI-[0-9A-HJKMNP-TV-Z]{8}$/;

// Member IDs use Crockford base32, which leaves out I, L, O and U so that a
// misread character maps to the digit it resembles.
const confusable: Record<string, string> = { O: "0", I: "1", L: "1" };

export function normalizeMemberReference(text: string) {
  const compact = text.trim().replace(/[\s_]+/g, "").toUpperCase();
  const match = /^BI-?([0-9A-Z]{8})$/.exec(compact);
  if (!match) return text.trim();
  const candidate = `BI-${match[1].replace(/[OIL]/g, character => confusable[character])}`;
  return memberIdPattern.test(candidate) ? candidate : text.trim();
}
