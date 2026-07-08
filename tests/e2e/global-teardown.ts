import { cleanupPlaywrightArtifacts } from "./helpers/supabase";

export default async function globalTeardown() {
  await cleanupPlaywrightArtifacts({ recomputeDriverPoints: true });
}
