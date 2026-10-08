import { setTimeout as delay } from "node:timers/promises";

try {
  const { probeLogin, smokeTarget } = await import("./lib/smoke-readiness.ts");
  const target = smokeTarget(process.env.PW_BASE_URL ?? "");
  for (let attempt = 1; attempt <= 30; attempt++) {
    const result = await probeLogin(target);
    if (result.ready) { console.log(result.reason); process.exit(0); }
    if (result.fatal) throw new Error(result.fatal);
    console.log(`Attempt ${attempt}/30: ${result.reason}`);
    if (attempt < 30) await delay(10_000);
  }
  throw new Error("Timed out waiting for the application login page. Check the deployment and its protection settings.");
} catch (error) {
  const message = error instanceof Error ? error.message : "Smoke readiness failed.";
  console.error(message);
  if (process.env.GITHUB_ACTIONS === "true") {
    // Make the sanitized failure available in public check annotations without
    // requiring anyone to download logs or grant account access.
    const escaped = message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
    console.error(`::error title=Anonymous smoke readiness::${escaped}`);
  }
  process.exitCode = 1;
}
