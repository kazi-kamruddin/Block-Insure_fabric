import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader activeRoute="/not-found" />
      <main id="main-content" tabIndex={-1} className="shell hero">
        <div className="eyebrow">404 · Route not found</div>
        <h1>This Block-Insure page does not exist.</h1>
        <p className="lede">Return to the public policy catalog or open the role workspace assigned to your demonstration identity.</p>
        <div className="actions">
          <Link className="primary" href="/">Return home</Link>
          <Link className="secondary" href="/workspace">Open role workspace</Link>
        </div>
      </main>
      <footer className="shell footer">
        <span>Block-Insure Fabric</span>
        <span>Deterministic · Auditable · Organization-scoped</span>
      </footer>
    </>
  );
}
