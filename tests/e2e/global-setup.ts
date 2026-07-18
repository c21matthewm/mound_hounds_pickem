export default async function globalSetup() {
  if (process.env.PW_READ_ONLY === "1") {
    return;
  }

  const { cleanupPlaywrightArtifacts, ensureActiveLeagueSeason, requireSupabaseE2EOptIn } = await import(
    "./helpers/supabase"
  );
  requireSupabaseE2EOptIn();
  await ensureActiveLeagueSeason();
  await cleanupPlaywrightArtifacts({ recomputeDriverPoints: true });
}
