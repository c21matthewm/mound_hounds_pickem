import {beforeEach,describe,expect,it,vi} from "vitest";
import {POST} from "@/app/api/admin/season-backups/route";
const m=vi.hoisted(()=>({client:vi.fn(),user:vi.fn(),profile:vi.fn(),rpc:vi.fn(),token:vi.fn(),path:vi.fn(),tag:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createServerSupabaseClient:m.client}));
vi.mock("@/lib/admin-request-token",()=>({verifyAdminRequestToken:m.token}));
vi.mock("@/lib/site-url",()=>({canonicalSiteOrigin:()=>"http://fixture.test"}));
vi.mock("@/lib/scoring-cache",()=>({SCORING_CACHE_TAG:"fixture-scoring"}));
vi.mock("next/cache",()=>({revalidatePath:m.path,revalidateTag:m.tag}));
const id="00000000-0000-4000-8000-000000000001";
const retention={seasonId:6,seasonYear:2026,routineLimit:3,totalCount:6,totalBytes:6144,routineCount:5,protectedCount:1,cleanupCount:2,cleanupBytes:2048,reviewToken:"a".repeat(64)};
const request=(body:Record<string,unknown>,origin="http://fixture.test")=>new Request("http://fixture.test/api/admin/season-backups",{method:"POST",headers:{origin,"content-type":"application/json","x-mound-hounds-request":"season-recovery","sec-fetch-site":"same-origin"},body:JSON.stringify({requestToken:"fixture-token",...body})});
beforeEach(()=>{
 vi.resetAllMocks();m.user.mockResolvedValue({data:{user:{id}},error:null});m.profile.mockResolvedValue({data:{role:"admin",is_active:false},error:null});m.token.mockReturnValue(true);
 const query={select:()=>query,eq:()=>query,maybeSingle:m.profile};m.client.mockResolvedValue({auth:{getUser:m.user},from:()=>query,rpc:m.rpc});
});
describe("Recovery retention API",()=>{
 it.each(["localhost:3007", "192.168.1.76:3007"])("accepts recovery previews through Next dev's bind address (%s)",async host=>{
  m.rpc.mockResolvedValue({data:retention,error:null});
  const browserRequest=new Request("http://0.0.0.0:3007/api/admin/season-backups",{method:"POST",headers:{host,origin:`http://${host}`,"content-type":"application/json","x-mound-hounds-request":"season-recovery","sec-fetch-site":"same-origin"},body:JSON.stringify({action:"retention-preview",seasonId:6,requestToken:"fixture-token"})});
  expect((await POST(browserRequest)).status).toBe(200);expect(m.rpc).toHaveBeenCalledExactlyOnceWith("get_season_restore_point_retention",{p_season_id:6});
 });
 it.each(["cross-site","same-site"])("still rejects a recovery request with incompatible Fetch Metadata (%s)",async fetchSite=>{
  const browserRequest=request({action:"retention-preview",seasonId:6});browserRequest.headers.set("sec-fetch-site",fetchSite);
  expect((await POST(browserRequest)).status).toBe(403);expect(m.client).not.toHaveBeenCalled();
 });
 it("still requires recovery's custom request header",async()=>{
  const browserRequest=request({action:"retention-preview",seasonId:6});browserRequest.headers.delete("x-mound-hounds-request");
  expect((await POST(browserRequest)).status).toBe(403);expect(m.client).not.toHaveBeenCalled();
 });
 it("rejects cross-origin requests before authentication or mutation",async()=>{expect((await POST(request({action:"cleanup"},"http://other.test"))).status).toBe(403);expect(m.client).not.toHaveBeenCalled();});
 it("requires an authenticated admin, including for previews",async()=>{
  m.user.mockResolvedValueOnce({data:{user:null},error:null});expect((await POST(request({action:"retention-preview",seasonId:6}))).status).toBe(401);
  m.profile.mockResolvedValueOnce({data:{role:"participant"},error:null});expect((await POST(request({action:"retention-preview",seasonId:6}))).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();
 });
 it("rejects an expired request token before invoking the RPC",async()=>{m.token.mockReturnValue(false);expect((await POST(request({action:"cleanup",seasonId:6,reviewToken:retention.reviewToken}))).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();});
 it("returns verified season totals for an admin not participating in the league",async()=>{m.rpc.mockResolvedValue({data:retention,error:null});const response=await POST(request({action:"retention-preview",seasonId:6}));expect(response.status).toBe(200);expect((await response.json()).data).toEqual(retention);expect(m.rpc).toHaveBeenCalledWith("get_season_restore_point_retention",{p_season_id:6});expect(m.path).not.toHaveBeenCalled();});
 it("rejects mismatched season totals",async()=>{m.rpc.mockResolvedValue({data:{...retention,seasonId:7},error:null});expect((await POST(request({action:"retention-preview",seasonId:6}))).status).toBe(400);});
 it("requires a reviewed token before cleanup",async()=>{expect((await POST(request({action:"cleanup",seasonId:6,reviewToken:"bad"}))).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();});
 it("passes the review token and invalidates only admin after cleanup",async()=>{m.rpc.mockResolvedValue({data:{deletedCount:2,deletedBytes:2048,retention},error:null});const response=await POST(request({action:"cleanup",seasonId:6,reviewToken:retention.reviewToken}));expect(response.status).toBe(200);expect(m.rpc).toHaveBeenCalledWith("cleanup_season_restore_points",{p_season_id:6,p_review_token:retention.reviewToken});expect(m.path).toHaveBeenCalledExactlyOnceWith("/admin");expect(m.tag).not.toHaveBeenCalled();});
 it("reports a stale preview without claiming cleanup succeeded",async()=>{m.rpc.mockResolvedValue({data:null,error:{code:"40001",message:"Backup retention changed. Review cleanup again."}});const response=await POST(request({action:"cleanup",seasonId:6,reviewToken:retention.reviewToken}));expect(response.status).toBe(400);expect((await response.json()).error).toContain("Review cleanup again");expect(m.path).not.toHaveBeenCalled();});
 it("does not turn a committed cleanup into a retry error when cache refresh fails",async()=>{m.rpc.mockResolvedValue({data:{deletedCount:2,deletedBytes:2048,retention},error:null});m.path.mockImplementation(()=>{throw new Error("cache fixture failure")});const response=await POST(request({action:"cleanup",seasonId:6,reviewToken:retention.reviewToken}));expect(response.status).toBe(200);expect((await response.json()).warning).toContain("cleanup completed");});
 it("validates the protection option before invoking its RPC",async()=>{expect((await POST(request({action:"protect",restorePointId:id,protected:"false"}))).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();});
 it("changes only the selected manual point's protection",async()=>{m.rpc.mockResolvedValue({data:{id,protected:true,retentionKey:"manual:protected",retention},error:null});expect((await POST(request({action:"protect",restorePointId:id,protected:true}))).status).toBe(200);expect(m.rpc).toHaveBeenCalledWith("set_season_restore_point_protection",{p_restore_point_id:id,p_protected:true});expect(m.tag).not.toHaveBeenCalled();});
 it("shows the migration needed when the retention RPC is unavailable",async()=>{m.rpc.mockResolvedValue({data:null,error:{code:"PGRST202",message:"fixture missing function"}});const response=await POST(request({action:"retention-preview",seasonId:6}));expect((await response.json()).error).toContain("20260930_recovery_retention.sql");});
 it.each([false,true])("creates a manual backup with its chosen permanent protection (%s)",async keepPermanently=>{m.rpc.mockResolvedValue({data:{id},error:null});expect((await POST(request({action:"create",seasonId:6,keepPermanently}))).status).toBe(200);expect(m.rpc).toHaveBeenCalledWith("create_season_restore_point_v2",expect.objectContaining({p_source:"manual",p_retention_key:keepPermanently?"manual:protected":null}));});
});
