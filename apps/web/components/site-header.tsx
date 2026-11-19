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
            <Link href="/" aria-current={activeRoute === "/" ? "page" : undefined}>
              Home
            </Link>
            <Link href="/showcase" aria-current={activeRoute === "/showcase" ? "page" : undefined}>
              Presentation
            </Link>
            <Link href="/workspace" aria-current={activeRoute === "/workspace" ? "page" : undefined}>
              Workspaces
            </Link>
            {showResearch && (
              <Link href="/research" aria-current={activeRoute === "/research" ? "page" : undefined}>
                Research
              </Link>
            )}
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
