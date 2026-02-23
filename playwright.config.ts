import { defineConfig, devices } from "@playwright/test";

const DEFAULT_PORT = 3007;
const baseURL = process.env.PW_BASE_URL ?? `http://127.0.0.1:${DEFAULT_PORT}`;
const useExistingServer = process.env.PW_USE_EXISTING_SERVER === "1";
const includeFirefox = process.env.CI === "true" || process.env.PW_INCLUDE_FIREFOX === "1";

const projects = [
  {
    name: "chromium-desktop",
    use: { ...devices["Desktop Chrome"] }
  },
  {
    name: "mobile-chromium",
    use: { ...devices["Pixel 7"] }
  }
];

if (includeFirefox) {
  projects.push({
    name: "firefox-desktop",
    use: { ...devices["Desktop Firefox"] }
  });
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 10 * 60 * 1000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "off"
  },
  webServer: useExistingServer
    ? undefined
    : {
        command: `npm run dev -- --port ${DEFAULT_PORT}`,
        url: `${baseURL}/login`,
        timeout: 180_000,
        reuseExistingServer: true
      },
  projects
});
