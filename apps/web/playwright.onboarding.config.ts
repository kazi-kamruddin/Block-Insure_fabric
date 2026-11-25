import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const outputDir = process.env.ONBOARDING_RESULTS_DIR;
const baseURL = process.env.ONBOARDING_BASE_URL;
if (!process.env.FABRIC_CHANNEL_NAME || !outputDir || !path.isAbsolute(outputDir) ||
    !baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)) {
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
    ...devices["Desktop Edge"], channel: "msedge", baseURL,
    actionTimeout: 25_000, navigationTimeout: 45_000,
    trace: "off", screenshot: "off", video: "off",
  },
});
