import Link from "next/link";

export default function NotFound() {
  return (
    <main className="shell hero">
      <div className="eyebrow">404 · Route not found</div>
      <h1>This Block-Insure page does not exist.</h1>
      <p className="lede">Return to the public policy catalog or open the role workspace assigned to your demonstration identity.</p>
      <div className="actions">
        <Link className="primary" href="/">Return home</Link>
        <Link className="secondary" href="/workspace">Open role workspace</Link>
      </div>
    </main>
  );
}
