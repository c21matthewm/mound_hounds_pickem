import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({client:vi.fn(()=>({})),rpc:vi.fn(),stage:vi.fn()}));
vi.mock("server-only",()=>({}));vi.mock("@/lib/supabase/service-role",()=>({createServiceRoleSupabaseClient:mocks.client}));vi.mock("@/lib/results-automation-store",()=>({automationRpc:mocks.rpc}));vi.mock("@/lib/results-automation",()=>({stageOfficialResults:mocks.stage,summarizeRun:(v:unknown)=>v}));
import {createResultsAutomationHandler} from "@/lib/results-automation-handler";
const secret="b".repeat(64);
const request=(body:unknown,key:string|null=secret)=>new Request("http://localhost/api/internal/results-automation",{method:"POST",headers:{"content-type":"application/json",...(key?{"x-webhook-secret":key}:{})},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("RESULTS_BRIDGE_SECRET",secret);});afterEach(()=>vi.unstubAllEnvs());
describe("staging-only capability boundary",()=>{
 it.each([null,"wrong"])("rejects unauthorized bridge access %s",async key=>{expect((await createResultsAutomationHandler()(request({action:"stage"},key))).status).toBe(401);expect(mocks.client).not.toHaveBeenCalled();});
 it.each(["publish","notifications","claim_notification","notification_result"])("retired operation cannot reach SQL: %s",async action=>{expect((await createResultsAutomationHandler()(request({action}))).status).toBe(400);expect(mocks.client).not.toHaveBeenCalled();});
 it("stages only and preserves idempotency",async()=>{mocks.stage.mockResolvedValue({status:"already_processed",run:null});const response=await createResultsAutomationHandler()(request({action:"stage",payload:{}}));expect(await response.json()).toMatchObject({status:"already_processed"});expect(response.headers.get("cache-control")).toBe("no-store");expect(mocks.stage).toHaveBeenCalledOnce();});
 it("fails closed without setup",async()=>{vi.stubEnv("RESULTS_BRIDGE_SECRET","");expect((await createResultsAutomationHandler()(request({action:"stage"}))).status).toBe(503);});
 it.each([["bad","application/json",400],["{}","text/plain",415],["x".repeat(131073),"application/json",413]])("bounds invalid input",async(body,type,status)=>{const response=await createResultsAutomationHandler()(new Request("http://localhost/api/internal/results-automation",{method:"POST",headers:{"content-type":String(type),"x-webhook-secret":secret},body:String(body)}));expect(response.status).toBe(status);expect(mocks.client).not.toHaveBeenCalled();});
});
