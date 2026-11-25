import { devLiteOrganizations, devLiteProfile, withDevLitePeer } from "./dev-lite-gateway.mjs";

const evaluateJson = async (contract, name, ...args) =>
  JSON.parse(Buffer.from(await contract.evaluateTransaction(name, ...args)).toString("utf8"));

const report = { peers: {}, oracleProof: "DOWN", balances: {} };
for (const org of devLiteOrganizations) {
  report.peers[org] = "DOWN";
  try {
    await withDevLitePeer(org, async ({ contract }) => {
      const schema = await evaluateJson(contract, "GetSchemaVersion");
      if (schema !== devLiteProfile.schemaVersion) return;
      report.peers[org] = "UP";
      if (org !== "insurer") return;

      try {
        const facts = await evaluateJson(contract, "ReadMedicalReviewFacts", "CLM-2026-000201");
        if (facts?.service && facts.quote) report.oracleProof = "UP";
      } catch {
        // Do not emit private fact bytes or peer errors.
      }

      for (const id of ["ACC-INS-PREM-7001", "ACC-INS-RSRV-7002"]) {
        try {
          const account = await evaluateJson(contract, "ReadBankAccountReference", id);
          if (Number.isSafeInteger(account.balanceMinor) && account.balanceMinor >= 0) {
            report.balances[id] = account.balanceMinor;
          }
        } catch {
          // Report a missing balance separately from peer reachability.
        }
      }
    });
  } catch {
    // The caller needs reachability, without identities or peer diagnostics.
  }
}
console.log(JSON.stringify(report));
