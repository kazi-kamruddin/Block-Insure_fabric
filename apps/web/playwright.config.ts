import { defineConfig, devices } from "@playwright/test";

const port = 3200;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
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
  webServer: {
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
    },
  },
});
