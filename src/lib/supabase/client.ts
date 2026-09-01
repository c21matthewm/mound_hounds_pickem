import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { getSupabaseEnv } from "./env";

export function createBrowserSupabaseClient() {
  const { anonKey, url } = getSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
