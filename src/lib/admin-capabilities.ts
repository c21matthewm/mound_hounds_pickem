import type { Json } from "@/lib/supabase/types";
export type AdminCapabilities = { items: {name:string;installed:boolean}[]; issue:string|null };
export function parseAdminCapabilities(data: Json | null, failed: boolean): AdminCapabilities {
  if (failed || !data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.items)
    || data.items.length === 0 || data.items.length > 20
    || data.items.some(item=>!item || typeof item !== "object" || Array.isArray(item) || typeof item.name !== "string" || typeof item.installed !== "boolean")) {
    return {items:[],issue:"Admin capability checks are unavailable. Apply 20260921_season_completion.sql if it has not been installed, then refresh System Health."};
  }
  return {items:data.items as {name:string;installed:boolean}[],issue:null};
}
