import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "test/browser",
  use: { headless: true, viewport: { width: 1440, height: 960 } },
  workers: 1,
  timeout: 30000,
});
