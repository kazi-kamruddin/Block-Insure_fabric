import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader activeRoute="/not-found" />
      <main id="main-content" tabIndex={-1} className="shell hero">
        <div className="eyebrow">404 · Page not found</div>
        <h1>This Block-Insure page does not exist.</h1>
        <p className="lede">Return to the home page or sign in to your workspace.</p>
        <div className="actions">
          <Link className="primary" href="/">Return home</Link>
          <Link className="secondary" href="/workspace">Sign in</Link>
        </div>
      </main>
      <footer className="shell footer">
        <span>Block-Insure</span>
        <span>Health insurance on a shared, verifiable ledger</span>
      </footer>
    </>
  );
}
