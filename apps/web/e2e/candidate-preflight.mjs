// Check the running server itself before any rehearsal can create ledger assets.
export default async function candidatePreflight() {
  const channel = "insurance-workflow-alignment-20261108";
  if (process.env.FABRIC_CHANNEL_NAME !== channel) throw new Error("Exact isolated candidate environment required");
  const response = await fetch("http://127.0.0.1:3200/api/fabric/health", { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Candidate Gateway preflight failed: HTTP ${response.status}`);
  const health = await response.json();
  if (health.status !== "ok" || health.channel !== channel || health.chaincode !== "insurance-contract" || health.schemaVersion !== 15) {
    throw new Error("Running server does not select the isolated schema-15 candidate; no rehearsal mutations permitted");
  }
}
