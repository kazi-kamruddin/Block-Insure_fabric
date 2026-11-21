import { defineConfig, devices } from "@playwright/test";

if (process.env.FABRIC_CHANNEL_NAME !== "insurance-dev-lite-190") {
  throw new Error("The premium journey runs only against the LevelDB dev-lite channel");
}
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results/premium-journey";
const protectCodes = process.env.DEV_LITE_PRIVATE_REHEARSAL === "true";
if (protectCodes) process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "premium-journey.spec.ts",
  workers: 1,
  retries: 0,
  outputDir,
  reporter: [["list"], ["json", { outputFile: outputDir + "/report.json" }]],
  use: {
    ...devices["Desktop Edge"], channel: "msedge", baseURL: "http://127.0.0.1:3219",
    actionTimeout: 25_000, navigationTimeout: 45_000,
    trace: protectCodes ? "off" : "retain-on-failure", screenshot: protectCodes ? "off" : "only-on-failure",
  },
});
