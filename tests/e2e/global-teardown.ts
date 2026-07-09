export default async function globalTeardown() {
  if (process.env.PW_READ_ONLY === "1") {
    return;
  }

  const { cleanupPlaywrightArtifacts } = await import("./helpers/supabase");
  await cleanupPlaywrightArtifacts({ recomputeDriverPoints: true });
}
