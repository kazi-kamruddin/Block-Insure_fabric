import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const channel = "insurance-dev-lite-190";
const outputDir = process.env.ONBOARDING_RESULTS_DIR;
if (process.env.FABRIC_CHANNEL_NAME !== channel || !outputDir || !path.isAbsolute(outputDir)) {
  throw new Error("Run the onboarding rehearsal through scripts/test-dev-lite-onboarding.ps1");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "onboarding-journey.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 900_000,
  outputDir: path.join(outputDir, "playwright"),
  reporter: [["list"], ["json", { outputFile: path.join(outputDir, "report.json") }]],
  use: {
    ...devices["Desktop Edge"], channel: "msedge", baseURL: "http://127.0.0.1:3219",
    actionTimeout: 25_000, navigationTimeout: 45_000,
    trace: "off", screenshot: "off", video: "off",
  },
});
