import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseDriverRosterSelection } from "@/lib/admin-driver-bulk";
import { bulkUpdateDriverRosterAction } from "@/app/admin/driver-bulk-actions";
const m=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),invalidate:vi.fn(),revalidate:vi.fn(),redirect:vi.fn(),report:vi.fn(),reportError:vi.fn()}));
vi.mock("@/lib/app-error-reporter",()=>({reportAppError:m.reportError}));
vi.mock("@/lib/admin",()=>({requireAdmin:m.auth}));vi.mock("@/lib/scoring-cache",()=>({invalidateScoringCache:m.invalidate}));vi.mock("next/cache",()=>({revalidatePath:m.revalidate}));vi.mock("@/app/admin/action-runtime",()=>({adminRedirect:m.redirect,reportAdminActionFailure:m.report,asText:(v:unknown)=>typeof v==="string"?v.trim():""}));
const form=(operation="deactivate",selection='[{"id":1,"expected_is_active":true}]')=>{const f=new FormData();f.set("operation",operation);f.set("selected_drivers",selection);return f;};
beforeEach(()=>{vi.resetAllMocks();m.auth.mockResolvedValue({supabase:{rpc:m.rpc},user:{id:"admin"}});m.rpc.mockResolvedValue({data:{changed_count:1},error:null});});
describe("bulk driver selection",()=>{
 it("keeps only ids and expected status",()=>{expect(parseDriverRosterSelection('[{"id":1,"expected_is_active":false,"ignored":1}]')).toEqual([{id:1,expected_is_active:false}]);});
 it.each(["", "null", "{}", "[]", '[{"id":1}]','[{"id":"1","expected_is_active":true}]','[{"id":-1,"expected_is_active":true}]','[{"id":1.5,"expected_is_active":true}]','[{"id":1,"expected_is_active":"true"}]','[{"id":1,"expected_is_active":true},{"id":1,"expected_is_active":true}]'])("refuses invalid selection %s",input=>{expect(()=>parseDriverRosterSelection(input)).toThrow();});
 it("bounds row count and raw input",()=>{expect(()=>parseDriverRosterSelection(JSON.stringify(Array.from({length:101},(_,i)=>({id:i+1,expected_is_active:true}))))).toThrow();expect(()=>parseDriverRosterSelection(" ".repeat(20001))).toThrow();});
});
describe("bulk roster action",()=>{
 it("authorizes before touching the roster",async()=>{m.auth.mockRejectedValue(new Error("Denied"));await expect(bulkUpdateDriverRosterAction(form())).rejects.toThrow("Denied");expect(m.rpc).not.toHaveBeenCalled();});
 it.each([["delete","[]"],["activate","[]"]])("rejects unsupported or empty changes (%s)",async(op,selection)=>{await bulkUpdateDriverRosterAction(form(op,selection));expect(m.rpc).not.toHaveBeenCalled();});
 it("dispatches one transaction with expected states and invalidates scoring views",async()=>{await bulkUpdateDriverRosterAction(form());expect(m.rpc).toHaveBeenCalledExactlyOnceWith("admin_set_driver_roster_status",{p_drivers:[{id:1,expected_is_active:true}],p_is_active:false});expect(m.invalidate).toHaveBeenCalledOnce();expect(m.revalidate).toHaveBeenCalledWith("/leaderboard");expect(m.redirect).toHaveBeenCalledWith("message",expect.stringContaining("1 driver updated"),"drivers");});
 it.each(["55P03","40001","40P01","PGRST202","42883"])("returns retry/setup errors without success (%s)",async code=>{m.rpc.mockResolvedValue({data:null,error:{code}});await bulkUpdateDriverRosterAction(form());expect(m.redirect).toHaveBeenCalledWith("error",expect.any(String),"drivers");expect(m.invalidate).not.toHaveBeenCalled();});
 it("reports stale selection or audit failure without claiming partial success",async()=>{m.rpc.mockResolvedValue({error:{code:"P0001",message:"Changed status"}});await bulkUpdateDriverRosterAction(form());expect(m.report).toHaveBeenCalledWith(expect.objectContaining({tab:"drivers",actorProfileId:"admin"}));expect(m.invalidate).not.toHaveBeenCalled();});
});

describe("unconfirmed roster responses", () => {
  it.each([null, {}, {changed_count:-1}, {changed_count:1.5}, {changed_count:2}])("does not claim success for a malformed result %j", async data => {
    m.rpc.mockResolvedValue({data,error:null});
    await bulkUpdateDriverRosterAction(form());
    expect(m.redirect).toHaveBeenCalledWith("error",expect.stringContaining("could not be confirmed"),"drivers");
    expect(m.invalidate).toHaveBeenCalledOnce();
    expect(m.rpc).toHaveBeenCalledOnce();
  });
  it.each(["", "PGRST000", "08006", "40003"])("refreshes after an ambiguous database response %s", async code => {
    m.rpc.mockResolvedValue({data:null,error:{code,message:"Connection unavailable"}});
    await bulkUpdateDriverRosterAction(form());
    expect(m.redirect).toHaveBeenCalledWith("error",expect.stringContaining("before retrying"),"drivers");
    expect(m.revalidate).toHaveBeenCalledWith("/leaderboard");
    expect(m.rpc).toHaveBeenCalledOnce();
  });
  it("retains check-before-retry guidance if the request and error reporting throw", async () => {
    m.rpc.mockRejectedValue(new Error("Network interrupted"));
    m.reportError.mockRejectedValue(new Error("Reporter unavailable"));
    await bulkUpdateDriverRosterAction(form());
    expect(m.redirect).toHaveBeenCalledWith("error",expect.stringContaining("check the selected drivers"),"drivers");
    expect(m.invalidate).toHaveBeenCalledOnce();
    expect(m.rpc).toHaveBeenCalledOnce();
  });
  it("accepts an idempotent zero-change response", async () => {
    m.rpc.mockResolvedValue({data:{changed_count:0},error:null});
    await bulkUpdateDriverRosterAction(form());
    expect(m.redirect).toHaveBeenCalledWith("message",expect.stringContaining("0 drivers updated"),"drivers");
  });
});
