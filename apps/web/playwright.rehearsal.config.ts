import { defineConfig, devices } from "@playwright/test";
if (process.env.FABRIC_CHANNEL_NAME !== "insurance-workflow-alignment-20261108") throw new Error("Browser rehearsal requires the existing isolated candidate channel");
export default defineConfig({
  globalSetup: "./e2e/candidate-preflight.mjs",
  testDir: "./e2e", testMatch: ["candidate-rehearsal.spec.ts", "candidate-evidence-recovery.spec.ts"], workers: 1, fullyParallel: false, retries: 0,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results/rehearsal",
  reporter: [["list"], ["json", { outputFile: `${process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results/rehearsal"}/report.json` }]],
  use: { ...devices["Desktop Edge"], channel: "msedge", baseURL: "http://127.0.0.1:3200", trace: "retain-on-failure", screenshot: "only-on-failure" },
});
