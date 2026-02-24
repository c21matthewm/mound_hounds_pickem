import type { Page } from "@playwright/test";

const DEFAULT_BASE_URL = process.env.PW_BASE_URL ?? "http://127.0.0.1:3007";

const parseUrlSafe = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const baseUrl = parseUrlSafe(DEFAULT_BASE_URL);
const baseHostname = baseUrl?.hostname ?? "127.0.0.1";
const baseOrigin = baseUrl?.origin ?? "http://127.0.0.1:3007";
const isKnownHydrationMismatch = (message: string): boolean =>
  message.includes("Hydration failed because the server rendered HTML didn't match the client.");

export const trackClientIssues = (page: Page, label: string, collector: string[]) => {
  page.on("pageerror", (error) => {
    if (isKnownHydrationMismatch(error.message)) {
      return;
    }
    collector.push(`[${label}] pageerror: ${error.message}`);
  });

  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }

    const text = message.text();
    if (text.includes("favicon.ico")) {
      return;
    }

    collector.push(`[${label}] console.error: ${text}`);
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    const parsed = parseUrlSafe(url);
    if (!parsed || parsed.hostname !== baseHostname) {
      return;
    }

    const failureText = request.failure()?.errorText ?? "Unknown network failure";
    if (failureText.includes("ERR_ABORTED") || failureText.includes("NS_BINDING_ABORTED")) {
      return;
    }

    collector.push(`[${label}] requestfailed: ${request.method()} ${url} -> ${failureText}`);
  });

  page.on("response", (response) => {
    const status = response.status();
    if (status < 500) {
      return;
    }

    const url = response.url();
    const parsed = parseUrlSafe(url);
    if (!parsed) {
      return;
    }

    // Capture 5xx responses from the target app host explicitly, including remote environments.
    if (parsed.hostname === baseHostname || parsed.origin === baseOrigin) {
      collector.push(`[${label}] HTTP ${status}: ${url}`);
    }
  });
};
