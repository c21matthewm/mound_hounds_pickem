import { setTimeout as delay } from "node:timers/promises";
import { probeLogin, smokeTarget } from "./lib/smoke-readiness.ts";

try {
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
  console.error(error instanceof Error ? error.message : "Smoke readiness failed.");
  process.exitCode = 1;
}
