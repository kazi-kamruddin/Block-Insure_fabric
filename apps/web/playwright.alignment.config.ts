import { defineConfig, devices } from "@playwright/test";
if (!process.env.FABRIC_CHANNEL_NAME?.startsWith("insurance-workflow-alignment-")) throw new Error("Alignment tests require an isolated alignment channel");
export default defineConfig({
  testDir: "./e2e", testMatch: ["alignment.spec.ts", "fabric-workflow.spec.ts"], workers: 1, fullyParallel: false,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
  reporter: [["list"], ["json", { outputFile: `${process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results"}/report.json` }]], retries: 0,
  use: { ...devices["Desktop Edge"], channel: "msedge", baseURL: "http://127.0.0.1:3200", trace: "retain-on-failure", screenshot: "only-on-failure" },
});
