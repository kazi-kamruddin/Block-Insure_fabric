import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

export type ActiveRoute = "/" | "/showcase" | "/workspace" | "/research" | "/not-found";

export function SiteHeader({
  activeRoute,
  navLabel = "Primary navigation",
  brandName = "Block-Insure",
  brandMark = "BI",
  brandHref = "/",
  pillText,
  pillHref,
  showResearch = false,
  portalVariant,
  signedIn = false,
}: {
  activeRoute: ActiveRoute;
  navLabel?: string;
  brandName?: string;
  brandMark?: string;
  brandHref?: string;
  pillText?: string;
  pillHref?: string;
  showResearch?: boolean;
  portalVariant?: "hospital" | "bank";
  /** Signed-in workspaces navigate from their own sidebar. */
  signedIn?: boolean;
}) {
  const brandNode = (
    <>
      <span className="brandMark" aria-hidden="true">{brandMark}</span>
      <span className="brandName">{brandName}</span>
    </>
  );

  return (
    <>
      <a className="skipLink" href="#main-content">Skip to main content</a>
      <header className={`floatingNavWrapper${portalVariant ? ` headerPortal-${portalVariant}` : ""}`}>
        <nav className="shell nav" aria-label={navLabel}>
          {brandHref.startsWith("#") ? (
            <a className="brand" href={brandHref} aria-label={`${brandName} home`}>
              {brandNode}
            </a>
          ) : (
            <Link className="brand" href={brandHref} aria-label={`${brandName} home`}>
              {brandNode}
            </Link>
          )}

          <div className="navLinks">
            {!signedIn && <>
              <Link href="/" aria-current={activeRoute === "/" ? "page" : undefined}>
                Home
              </Link>
              <Link href="/showcase" aria-current={activeRoute === "/showcase" ? "page" : undefined}>
                How it works
              </Link>
              {showResearch && (
                <Link href="/research" aria-current={activeRoute === "/research" ? "page" : undefined}>
                  Research
                </Link>
              )}
              <Link href="/workspace" aria-current={activeRoute === "/workspace" ? "page" : undefined}>
                Sign in
              </Link>
            </>}
            {pillText && (
              pillHref ? (
                <Link className="networkPill" href={pillHref}>
                  <span className="status-dot-pulse" aria-hidden="true" />
                  <span>{pillText}</span>
                </Link>
              ) : (
                <span className="networkPill">
                  <span className="status-dot-pulse" aria-hidden="true" />
                  <span>{pillText}</span>
                </span>
              )
            )}
            <ThemeToggle />
          </div>
        </nav>
      </header>
    </>
  );
}
