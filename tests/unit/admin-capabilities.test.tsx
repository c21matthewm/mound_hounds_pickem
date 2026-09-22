import {describe,expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {parseAdminCapabilities} from "@/lib/admin-capabilities";
import {AdminSystemHealth} from "@/components/admin-system-health";
import {parseAdminAuditQuery} from "@/lib/admin-audit-log";
import {EXPECTED_SCHEMA_VERSION} from "@/lib/supabase/schema-version";
vi.mock("@/app/admin/race-week-actions",()=>({triggerFantasyWinnerJobAction:async()=>{}}));
const base={appErrorInboxReady:true,appErrorInboxIssue:null,appErrors:[],auditLog:{query:parseAdminAuditQuery({}),rows:[],hasOlder:false,hasNewer:false,detail:null,error:null,detailError:null},cleanupTestFlowDataAction:async()=>{},currentTime:Date.now(),emailEnabled:false,healthContract:{healthy:true,missing:[],version:EXPECTED_SCHEMA_VERSION},jobEvents:[],jobRuns:[],openAppErrorCount:0,reminderRows:[],resolveAppErrorAction:async()=>{},schemaVersion:EXPECTED_SCHEMA_VERSION};
describe("Admin capability and off-season diagnostics",()=>{
 it.each([null,{},[],{items:[]},{items:[{name:"bad",installed:"yes"}]}])("does not turn unavailable/malformed checks into a green result (%j)",data=>{expect(parseAdminCapabilities(data,false).issue).not.toBeNull();});
 it("shows each missing capability even when the base schema is healthy",()=>{const capabilities=parseAdminCapabilities({items:[{name:"Season completion",installed:false}]},false);const html=renderToStaticMarkup(<AdminSystemHealth {...base} capabilities={capabilities} activeSeasonYear={null}/>);expect(html).toContain("Action needed");expect(html).toContain("Missing");expect(html).toContain("Season completion");});
 it("does not demand a race-job heartbeat between seasons",()=>{const capabilities=parseAdminCapabilities({items:[{name:"Season completion",installed:true}]},false);const html=renderToStaticMarkup(<AdminSystemHealth {...base} capabilities={capabilities} activeSeasonYear={null}/>);expect(html).toContain("System ready");expect(html).toContain("between seasons");const active=renderToStaticMarkup(<AdminSystemHealth {...base} capabilities={capabilities} activeSeasonYear={2027}/>);expect(active).toContain("Action needed");});
});
