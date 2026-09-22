import {beforeEach,describe,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({client:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/service-role",()=>({createServiceRoleSupabaseClient:m.client}));
import {finalizeDueRaceWinners} from "@/lib/fantasy-winner";
beforeEach(()=>vi.resetAllMocks());
describe("winner jobs after season closeout",()=>{
 it("ignores completed seasons and unpublished races even if they retain an old eligibility date",async()=>{
   let records=[{id:1,'league_seasons.status':'completed',results_status:'published',is_archived:false,winner_is_manual_override:false},{id:2,'league_seasons.status':'active',results_status:'draft',is_archived:false,winner_is_manual_override:false}] as Record<string,unknown>[];
   const query={select:()=>query,eq:(key:string,value:unknown)=>{records=records.filter(row=>row[key]===value);return query;},not:()=>query,lte:()=>query,order:()=>query,limit:async()=>({data:records,error:null})};
   m.client.mockReturnValue({from:()=>query});
   expect(await finalizeDueRaceWinners()).toEqual({failedRaceCount:0,failures:[],processedRaceCount:0,updatedRaceCount:0});
 });
});
