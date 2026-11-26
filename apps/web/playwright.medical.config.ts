import { defineConfig, devices } from "@playwright/test";

if (!["insurance-medical-reimbursement", "insurance-dev-lite-190"].includes(process.env.FABRIC_CHANNEL_NAME ?? "")) {
  throw new Error("The medical rehearsal requires the isolated medical channel");
}
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results/medical-rehearsal";
const protectCodes = process.env.DEV_LITE_PRIVATE_REHEARSAL === "true";
if (protectCodes) process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "medical-rehearsal.spec.ts",
  workers: 1,
  retries: 0,
  outputDir,
  reporter: [["list"], ["json", { outputFile: outputDir + "/report.json" }]],
  use: {
    ...devices["Desktop Edge"], channel: "msedge", baseURL: process.env.FABRIC_CHANNEL_NAME === "insurance-dev-lite-190" ? "http://127.0.0.1:3219" : "http://127.0.0.1:3210",
    actionTimeout: 25_000, navigationTimeout: 45_000,
    trace: protectCodes ? "off" : "retain-on-failure", screenshot: protectCodes ? "off" : "only-on-failure",
  },
});
