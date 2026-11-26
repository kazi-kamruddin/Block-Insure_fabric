import { devLiteOrganizations, devLiteProfile, withDevLitePeer } from "./dev-lite-gateway.mjs";

const evaluateJson = async (contract, name, ...args) =>
  JSON.parse(Buffer.from(await contract.evaluateTransaction(name, ...args)).toString("utf8"));

const timingProfile = async contract => {
  const record = await evaluateJson(contract, "ReadMedicalTimingProfile");
  if (!["REAL", "DEMO"].includes(record.profile) || !Number.isSafeInteger(record.revision) || record.revision < 0) {
    throw new Error("Invalid timing profile readback");
  }
  return { profile: record.profile, revision: record.revision };
};

if (process.argv.includes("--timing-profile-only")) {
  try {
    const profile = await withDevLitePeer("insurer", ({ contract }) => timingProfile(contract));
    console.log(JSON.stringify(profile));
  } catch {
    process.exitCode = 1;
  }
} else {
  console.log(JSON.stringify(await inspectPeers()));
}

async function inspectPeers() {
  const report = { peers: {}, oracleProof: "DOWN", balances: {} };
  for (const org of devLiteOrganizations) {
    report.peers[org] = "DOWN";
    try {
      await withDevLitePeer(org, async ({ contract }) => {
        const schema = await evaluateJson(contract, "GetSchemaVersion");
        if (schema !== devLiteProfile.schemaVersion) return;
        report.peers[org] = "UP";
        if (org !== "insurer") return;

        if (devLiteProfile.expectedSequence >= 3) {
          try { report.timingProfile = await timingProfile(contract); } catch { report.timingProfile = null; }
        }

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
  return report;
}
