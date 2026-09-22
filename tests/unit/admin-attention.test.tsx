import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminWorkspaceNav } from "@/components/admin-workspace-nav";
import { loadAdminAttention } from "@/lib/admin-attention";
import type { AppSupabaseClient } from "@/lib/supabase/types";
vi.mock("server-only",()=>({}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn()})}));
const now=Date.parse("2027-05-01T12:00:00Z");
function client(error=false) {
 const calls:unknown[][]=[];
 const from=vi.fn((table:string)=>{
  const q={select:(...args:unknown[])=>{calls.push([table,"select",...args]);return q;},eq:(...args:unknown[])=>{calls.push([table,"eq",...args]);return q;},lte:(...args:unknown[])=>{calls.push([table,"lte",...args]);return q;},then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({count:table==="races"?2:4,error:error?{message:"Unavailable"}:null}).then(resolve)};
  return q;
 });
 return {supabase:{from} as unknown as AppSupabaseClient,from,calls};
}
describe("admin navigation attention",()=>{
 it("requests only counts for open errors and due unpublished active-season races",async()=>{
  const c=client();expect(await loadAdminAttention(c.supabase,{seasonId:8,now,loadErrors:true,loadRaces:true})).toEqual({openErrors:4,unpublishedRaces:2});
  expect(c.calls).toContainEqual(["races","eq","season_id",8]);expect(c.calls).toContainEqual(["races","eq","is_archived",false]);expect(c.calls).toContainEqual(["races","eq","results_status","draft"]);expect(c.calls).toContainEqual(["races","lte","race_date",new Date(now).toISOString()]);expect(c.calls.filter(c=>c[1]==="select")).toEqual([["app_error_events","select","id",{count:"exact",head:true}],["races","select","id",{count:"exact",head:true}]]);
 });
 it("reuses already loaded calendar and health counts without duplicate queries",async()=>{const c=client();await loadAdminAttention(c.supabase,{seasonId:8,now,loadErrors:false,loadRaces:false});expect(c.from).not.toHaveBeenCalled();});
 it("leaves missing diagnostics unknown and skips races without an active season",async()=>{const c=client(true);expect(await loadAdminAttention(c.supabase,{seasonId:null,now,loadErrors:true,loadRaces:true})).toEqual({openErrors:null,unpublishedRaces:null});expect(c.from).toHaveBeenCalledExactlyOnceWith("app_error_events");});
 it("labels badges for accessibility and mobile navigation, leaving zero or unknown unbadged",()=>{
  const html=renderToStaticMarkup(<AdminWorkspaceNav activeTab="results" openErrorCount={4} unpublishedRaceCount={2} />);expect(html).toContain('aria-label="4 open application errors"');expect(html).toContain('aria-label="2 completed races awaiting published results"');expect(html).toContain("Race Week · 2 need attention");
  const quiet=renderToStaticMarkup(<AdminWorkspaceNav activeTab="seasons" openErrorCount={null} unpublishedRaceCount={0} />);expect(quiet).not.toContain("need attention");
 });
});
