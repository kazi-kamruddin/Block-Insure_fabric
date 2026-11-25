import { defineConfig, devices } from "@playwright/test";
import profile from "../../scripts/profiles/dev-lite-190.json";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "accessibility.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  projects: [{
    name: "dev-lite-chromium",
    use: {
      ...devices["Desktop Edge"],
      browserName: "chromium",
      channel: "msedge",
      baseURL: `http://127.0.0.1:${profile.webPort}`,
      trace: "off",
      screenshot: "off",
      video: "off",
    },
  }],
});
