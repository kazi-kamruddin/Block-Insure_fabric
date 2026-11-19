import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const build = process.env.MEDICAL_OCR_BUILD;
if (!build || !path.isAbsolute(build)) throw new Error("Set MEDICAL_OCR_BUILD to an isolated standalone build directory");
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results/medical-ocr";
const baseURL = "http://127.0.0.1:3225";
export default defineConfig({
  testDir: "./e2e", testMatch: "medical-ocr.spec.ts", workers: 1, retries: 0, outputDir,
  reporter: [["list"], ["json", { outputFile: outputDir + "/report.json" }]],
  use: { ...devices["Desktop Edge"], channel: "msedge", baseURL, trace: "retain-on-failure" },
  webServer: { cwd: path.join(build, ".next", "standalone"), command: "node server.js",
    url: baseURL + "/api/health/live", timeout: 30_000, reuseExistingServer: false,
    env: { HOSTNAME: "127.0.0.1", PORT: "3225", APP_ORIGIN: baseURL, ENABLE_DEMO_AUTH: "true",
      SESSION_COOKIE_SECURE: "false", AUTH_SECRET: "synthetic-offline-medical-ocr-test-only",
      FABRIC_CHANNEL_NAME: "insurance-medical-reimbursement", FABRIC_NETWORK_ROOT: path.join(build, "no-identities"),
      FABRIC_MEDICAL_REVIEW_ENABLED: "true", EMAIL_GATEWAY_URL: " ", EMAIL_GATEWAY_TOKEN: " " } },
});
