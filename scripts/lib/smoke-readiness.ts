export function smokeTarget(value: string): URL {
  let target: URL;
  try { target = new URL(value); }
  catch { throw new Error("PW_BASE_URL must be a valid application origin."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if (
    (target.protocol !== "https:" && !(target.protocol === "http:" && loopback)) ||
    target.hostname.includes("*") || target.username || target.password || target.search || target.hash || target.pathname !== "/"
  ) {
    throw new Error("PW_BASE_URL must be an HTTPS application origin without credentials, a path, or query parameters (HTTP is allowed only for localhost).");
  }
  if (/^moundhoundspickem-[a-z0-9-]+-c21matthewms-projects\.vercel\.app$/.test(target.hostname)) {
    throw new Error("Protected Vercel previews are excluded from smoke checks. Use the public production origin.");
  }
  return target;
}

export type SmokeEvent = {
  deployment?: { production_environment?: boolean; environment?: string };
  deployment_status?: { state?: string };
  inputs?: { base_url?: string };
};

export function selectSmokeTarget(eventName: string, event: SmokeEvent, fallbackURL = ""): URL | null {
  if (eventName === "deployment_status") {
    // Vercel's existing Production events use production_environment=false.
    // Honor its explicit environment name and always exclude Preview events.
    const environment = event.deployment?.environment?.trim().toLowerCase();
    const production = environment === "production" ||
      (event.deployment?.production_environment === true && environment !== "preview");
    if (event.deployment_status?.state !== "success" || !production) {
      return null;
    }
  } else if (eventName !== "workflow_dispatch") {
    throw new Error("Smoke checks run only after a successful production deployment or a manual dispatch.");
  }
  // Deployment URLs can be protected Vercel hosts. Use the public production alias.
  return smokeTarget((eventName === "workflow_dispatch" ? event.inputs?.base_url : "") || fallbackURL || "https://moundhoundspickem.app");
}

export type LoginProbe = { ready: boolean; fatal?: string; reason: string };
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

async function boundedHtml(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 512 * 1024) throw new Error("Login response exceeded the readiness limit.");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function probeLogin(
  target: URL,
  fetchRequest: typeof fetch = fetch
): Promise<LoginProbe> {
  let next = new URL("/login", target);
  const headers: Record<string, string> = { accept: "text/html" };
  try {
    // A protected deployment or foreign redirect cannot count as application readiness.
    for (let hop = 0; hop < 5; hop++) {
      const response = await fetchRequest(next, {
        method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(15_000)
      });
      if (redirectStatuses.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) return { ready: false, reason: "Login returned a redirect without a destination." };
        const redirected = new URL(location, next);
        if (redirected.origin !== target.origin || redirected.username || redirected.password) {
          const message = "Login redirected outside the public application. Protected previews are excluded from smoke checks; use the public production origin.";
          return { ready: false, fatal: message, reason: message };
        }
        next = redirected;
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        const message = "Public login access was denied. Smoke checks require a public production URL and never bypass Deployment Protection.";
        return { ready: false, fatal: message, reason: message };
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        return { ready: false, reason: `Login returned HTTP ${response.status}.` };
      }
      const html = await boundedHtml(response);
      const appLogin = /<title>Mound Hounds Pick(?:&#x27;|&#39;|')em<\/title>/.test(html) &&
        /<h[1-6]\b[^>]*>\s*Sign in\s*<\/h[1-6]>/.test(html) &&
        /name="password"/.test(html) && /href="\/signup"/.test(html);
      return { ready: appLogin, reason: appLogin ? "Application login is ready." : "HTTP 200 did not contain the application's login page." };
    }
    return { ready: false, reason: "Login exceeded the same-origin redirect limit." };
  } catch {
    // Keep request metadata and response bodies out of diagnostics.
    return { ready: false, reason: "Login request failed or exceeded its response/time limit." };
  }
}
