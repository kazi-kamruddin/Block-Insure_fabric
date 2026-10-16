import { defineConfig } from "@playwright/test";
import liveConfig from "./playwright.config";

// Exercise the built browser/API boundary without starting Oracle workers or
// writing to a Fabric channel. Live workflow tests retain their own config.
export default defineConfig({
  ...liveConfig,
  testMatch: "offline.spec.ts",
  webServer: Array.isArray(liveConfig.webServer)
    ? liveConfig.webServer.filter((server) => server.command === "npm run start")
    : liveConfig.webServer,
});
