import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const outputDir = process.env.SEED_RESULTS_DIR;
if (process.env.FABRIC_CHANNEL_NAME !== "insurance-dev-lite-190" || !outputDir || !path.isAbsolute(outputDir)) {
  throw new Error("Seed the demonstration ledger through scripts/seed-dev-lite-demo.ps1");
}

// API-only seeding of a freshly deployed dev-lite ledger. Codes stay on screen,
// so traces, screenshots and video are off.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "demo-seed.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 1_800_000,
  outputDir: path.join(outputDir, "playwright"),
  reporter: [["list"], ["json", { outputFile: path.join(outputDir, "report.json") }]],
  use: { ...devices["Desktop Edge"], channel: "msedge", baseURL: "http://127.0.0.1:3219", trace: "off", screenshot: "off", video: "off" },
});
