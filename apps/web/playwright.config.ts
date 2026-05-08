import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "corepack pnpm --filter @typedance/web dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1366, height: 900 }
  }
});
