import Link from "next/link";

export default function WorkspaceSectionNotFound() {
  return (
    <section className="workCard workspaceNotFound" aria-labelledby="workspace-not-found">
      <h2 id="workspace-not-found">Page not found</h2>
      <p>This page is not part of your workspace.</p>
      <Link className="primary button" href="/workspace">Back to overview</Link>
    </section>
  );
}
