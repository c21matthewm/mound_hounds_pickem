import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type AppSupabaseClient = SupabaseClient<Database>;

export type {
  Database,
  FunctionArgs,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate
} from "@/lib/supabase/database.types";
