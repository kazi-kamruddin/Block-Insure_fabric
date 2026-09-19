import { defineConfig, devices } from "@playwright/test";

const port = 3200;
const baseURL = `http://127.0.0.1:${port}`;
const oracleScenario = process.env.ORACLE_E2E_SCENARIO ?? "baseline";
const oracle2Environment = oracleScenario === "conflict"
  ? "../../services/oracle-worker/.env.oracle2-conflict.example"
  : "../../services/oracle-worker/.env.oracle2.example";

const oracleServers = [
  {
    command: "node ../../services/oracle-worker/src/index.mjs --env=../../services/oracle-worker/.env.oracle1.example",
    url: "http://127.0.0.1:3301/health",
    reuseExistingServer: true,
    timeout: 30_000,
  },
  ...(oracleScenario === "timeout" ? [] : [{
    command: `node ../../services/oracle-worker/src/index.mjs --env=${oracle2Environment}`,
    url: "http://127.0.0.1:3302/health",
    reuseExistingServer: true,
    timeout: 30_000,
  }]),
];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // The live Fabric tests intentionally share one channel and world state.
  // Serial execution avoids cross-file contention and makes replay-protection
  // assertions deterministic on developer machines and CI alike.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Edge"],
    channel: "msedge",
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run start",
      url: `${baseURL}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ENABLE_DEMO_AUTH: "true",
        AUTH_SECRET: "browser-test-only-secret-with-at-least-32-characters",
        SESSION_COOKIE_SECURE: "false",
        APP_ORIGIN: baseURL,
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        EVENT_WORKER_SECRET: "browser-event-worker-secret-with-32-characters",
        FABRIC_EVENT_SYNC_DEADLINE_SECONDS: "5",
        FABRIC_EVALUATE_DEADLINE_SECONDS: "15",
      },
    },
    ...oracleServers,
  ],
});
