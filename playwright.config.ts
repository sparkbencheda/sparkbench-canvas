import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.pw.ts",
  use: {
    browserName: "chromium",
    headless: true,
  },
  webServer: {
    command: "npx serve tests/e2e/dist -l 3999 --no-clipboard",
    port: 3999,
    reuseExistingServer: true,
  },
});
