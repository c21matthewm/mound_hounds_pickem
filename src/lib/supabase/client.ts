import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

export function createBrowserSupabaseClient() {
  const { anonKey, url } = getSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
