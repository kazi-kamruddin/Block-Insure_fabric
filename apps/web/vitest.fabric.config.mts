import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["e2e/transaction-recovery.integration.ts"], environment: "node", fileParallelism: false, maxWorkers: 1, testTimeout: 120000, hookTimeout: 30000 },
});
