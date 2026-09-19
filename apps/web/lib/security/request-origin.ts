export type MutationTrustResult =
  | { trusted: true }
  | { trusted: false; reason: string };

export function checkMutationOrigin(request: Request): MutationTrustResult {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return { trusted: false, reason: "Cross-site mutation requests are not allowed" };
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    // Non-browser tools commonly omit Origin. Browser cross-site requests are
    // still rejected by Sec-Fetch-Site and SameSite=Strict session cookies.
    return { trusted: true };
  }

  const requestOrigin = new URL(request.url).origin;
  const configuredOrigin = process.env.APP_ORIGIN?.replace(/\/$/, "");
  if (origin !== requestOrigin && origin !== configuredOrigin) {
    return { trusted: false, reason: "Request origin does not match this application" };
  }

  return { trusted: true };
}
