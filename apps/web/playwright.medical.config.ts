import { defineConfig, devices } from "@playwright/test";

if (process.env.FABRIC_CHANNEL_NAME !== "insurance-medical-reimbursement") {
  throw new Error("The medical rehearsal requires the isolated medical channel");
}
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results/medical-rehearsal";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "medical-rehearsal.spec.ts",
  workers: 1,
  retries: 0,
  outputDir,
  reporter: [["list"], ["json", { outputFile: outputDir + "/report.json" }]],
  use: {
    ...devices["Desktop Edge"], channel: "msedge", baseURL: "http://127.0.0.1:3210",
    actionTimeout: 25_000, navigationTimeout: 45_000,
    trace: "retain-on-failure", screenshot: "only-on-failure",
  },
});
