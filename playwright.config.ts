import { defineConfig, devices } from "@playwright/test";

const DEFAULT_PORT = 3007;
const baseURL = process.env.PW_BASE_URL ?? `http://127.0.0.1:${DEFAULT_PORT}`;
const useExistingServer = process.env.PW_USE_EXISTING_SERVER === "1";
const readOnly = process.env.PW_READ_ONLY === "1";
const includeFirefox = process.env.CI === "true" || process.env.PW_INCLUDE_FIREFOX === "1";

if (
  !readOnly &&
  useExistingServer &&
  process.env.PW_CONFIRM_EXISTING_SERVER_IS_ISOLATED !== "1"
) {
  throw new Error(
    "Mutating E2E cannot use an existing server without PW_CONFIRM_EXISTING_SERVER_IS_ISOLATED=1."
  );
}

const isolatedServerEnv =
  !readOnly &&
  process.env.E2E_SUPABASE_URL &&
  process.env.E2E_SUPABASE_ANON_KEY &&
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
    ? {
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY,
        NEXT_PUBLIC_SUPABASE_URL: process.env.E2E_SUPABASE_URL,
        NEXT_PUBLIC_SITE_URL: baseURL,
        SUPABASE_SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
      }
    : undefined;

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
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
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
        env: isolatedServerEnv,
        url: `${baseURL}/login`,
        timeout: 180_000,
        reuseExistingServer: true
      },
  projects
});
