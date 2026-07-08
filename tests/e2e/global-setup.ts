import { cleanupPlaywrightArtifacts, requireSupabaseE2EOptIn } from "./helpers/supabase";

export default async function globalSetup() {
  requireSupabaseE2EOptIn();
  await cleanupPlaywrightArtifacts({ recomputeDriverPoints: true });
}
