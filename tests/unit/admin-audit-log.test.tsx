import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminAuditLog } from "@/components/admin-audit-log";
import { adminAuditHref, adminAuditStatePreview, escapeAdminAuditSearch, parseAdminAuditQuery, type AdminAuditListRow, type AdminAuditLogData } from "@/lib/admin-audit-log";
import { loadAdminAuditLog } from "@/lib/admin-audit-log-data";
import type { AppSupabaseClient } from "@/lib/supabase/types";
vi.mock("server-only", () => ({}));
const row = (id: number): AdminAuditListRow => ({id,action:"publish_results",entity_type:"race",entity_id:"11",summary:`Published race ${id}`,created_at:"2027-05-01T12:00:00Z"});
const data = (patch: Partial<AdminAuditLogData> = {}): AdminAuditLogData => ({query:parseAdminAuditQuery({}),rows:[],detail:null,hasOlder:false,hasNewer:false,error:null,detailError:null,...patch});
function client(source: AdminAuditListRow[], options: {failList?:boolean;failDetail?:boolean;throwList?:boolean} = {}) {
  const calls: unknown[][] = [];
  const from = vi.fn((table:string) => {
    let records = [...source];
    let ascending = false;
    let limit = Infinity;
    const q = {
      select: (columns:string) => {calls.push([table,"select",columns]);return q;},
      order: (column:string,options:{ascending:boolean}) => {calls.push([table,"order",column,options]);ascending=options.ascending;return q;},
      limit: (count:number) => {calls.push([table,"limit",count]);limit=count;return q;},
      abortSignal: (signal:AbortSignal) => {calls.push([table,"abortSignal",signal]);return q;},
      eq: (key:keyof AdminAuditListRow,value:unknown) => {calls.push([table,"eq",key,value]);records=records.filter(row=>row[key]===value);return q;},
      regexIMatch: (key:"summary",pattern:string) => {calls.push([table,"regexIMatch",key,pattern]);records=records.filter(row=>new RegExp(pattern,"i").test(row[key]));return q;},
      lt: (key:"id",value:number) => {calls.push([table,"lt",key,value]);records=records.filter(row=>row[key]<value);return q;},
      gt: (key:"id",value:number) => {calls.push([table,"gt",key,value]);records=records.filter(row=>row[key]>value);return q;},
      maybeSingle: () => {calls.push([table,"maybeSingle"]);return Promise.resolve({data:options.failDetail?null:{id:records[0]?.id,actor_profile_id:"fixture-admin",before_state:{role:"user",api_key:"fixture-hidden-value"},after_state:{role:"admin"}},error:options.failDetail?{message:"Private error"}:null});},
      then: (resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown) => {
        if(options.throwList) return Promise.reject(new Error("Private network issue")).then(resolve,reject);
        return Promise.resolve({data:records.sort((a,b)=>ascending?a.id-b.id:b.id-a.id).slice(0,limit),error:options.failList?{message:"Private database issue"}:null}).then(resolve,reject);
      }
    };
    return q;
  });
  return {supabase:{from} as unknown as AppSupabaseClient,calls,from};
}

describe("admin audit query and navigation",()=>{
  it("accepts bounded filters and strict safe integer references",()=>{
    expect(parseAdminAuditQuery({audit_q:" race ",audit_action:["publish_results","delete"],audit_entity:"race",audit_before:"30",audit_event:"29"})).toEqual({search:"race",action:"publish_results",entity:"race",before:30,after:null,detail:29,notice:null});
    for(const value of ["-1","1.2","1e2","9007199254740992","0","1,2"]) expect(parseAdminAuditQuery({audit_before:value}).before).toBeNull();
  });
  it("makes malformed filters, excessive text, and conflicting cursors visible",()=>{
    const query=parseAdminAuditQuery({audit_q:"q".repeat(200),audit_entity:"race.or(id.gt.0)",audit_action:"%",audit_before:"20",audit_after:"10"});
    expect(query.search).toHaveLength(120);expect(query.entity).toBe("");expect(query.action).toBe("");expect(query.before).toBeNull();expect(query.after).toBeNull();expect(query.notice).toContain("Conflicting");expect(query.notice).toContain("shortened");expect(query.notice).toContain("filter");
  });
  it("treats all regular expression characters and LIKE wildcards as literal text",()=>{
    const text=String.raw`50%_* [a].+?($)\test|^end{2}`;
    const pattern=escapeAdminAuditSearch(text);
    expect(new RegExp(pattern,"i").test(`prefix ${text} suffix`)).toBe(true);
    expect(new RegExp(pattern,"i").test("50anything arbitrary end")).toBe(false);
  });
  it("keeps filters and the current page for detail, and resets detail when paging",()=>{
    const query=parseAdminAuditQuery({audit_q:"% & race",audit_action:"publish_results",audit_entity:"race",audit_before:"50",audit_event:"48"});
    const detail = new URL(adminAuditHref(query,{detail:46}),"http://local.test");
    expect(detail.searchParams.get("audit_before")).toBe("50");expect(detail.searchParams.get("audit_q")).toBe("% & race");expect(detail.searchParams.get("audit_event")).toBe("46");expect(detail.hash).toBe("#audit-event-46");
    const newer = new URL(adminAuditHref(query,{after:49}),"http://local.test");
    expect(newer.searchParams.get("audit_after")).toBe("49");expect(newer.searchParams.has("audit_before")).toBe(false);expect(newer.searchParams.has("audit_event")).toBe(false);
    const latest = new URL(adminAuditHref(query,{latest:true}),"http://local.test");
    expect(latest.searchParams.has("audit_before")).toBe(false);expect(latest.searchParams.get("audit_action")).toBe("publish_results");
  });
});

describe("admin audit data loading",()=>{
  it("loads at most 26 lightweight rows without state, joins, or global counts",async()=>{
    const c=client(Array.from({length:60},(_,index)=>row(index+1)));
    const result=await loadAdminAuditLog(c.supabase,parseAdminAuditQuery({}));
    expect(result.rows).toHaveLength(25);expect(result.rows[0].id).toBe(60);expect(result.rows.at(-1)?.id).toBe(36);
    expect(result.hasOlder).toBe(true);expect(result.hasNewer).toBe(false);expect(c.from).toHaveBeenCalledTimes(1);
    expect(c.calls).toContainEqual(["admin_audit_events","select","id,action,entity_type,entity_id,summary,created_at"]);
    expect(c.calls).toContainEqual(["admin_audit_events","limit",26]);expect(c.calls.some(call=>call[1]==="abortSignal")).toBe(true);
  });
  it("returns adjacent older and newer pages without overlap even if new events arrive",async()=>{
    const source=Array.from({length:60},(_,index)=>row(index+1));
    const olderClient=client(source);
    const older=await loadAdminAuditLog(olderClient.supabase,parseAdminAuditQuery({audit_before:"36"}));
    expect(older.rows.map(row=>row.id)).toEqual(Array.from({length:25},(_,index)=>35-index));expect(older.hasNewer).toBe(true);expect(older.hasOlder).toBe(true);
    const newerClient=client([...source,row(61)]);
    const newer=await loadAdminAuditLog(newerClient.supabase,parseAdminAuditQuery({audit_after:String(older.rows[0].id)}));
    expect(newer.rows.map(row=>row.id)).toEqual(Array.from({length:25},(_,index)=>60-index));expect(newer.hasNewer).toBe(true);expect(newer.hasOlder).toBe(true);
    expect(newerClient.calls).toContainEqual(["admin_audit_events","order","id",{ascending:true}]);
  });
  it("applies exact filters and literal case-insensitive summary search server side",async()=>{
    const c=client([{...row(5),summary:"Published Race 50%_*"},row(4),{...row(3),summary:"Published Race 50%_*",action:"delete"}]);
    const result=await loadAdminAuditLog(c.supabase,parseAdminAuditQuery({audit_q:"race 50%_*",audit_action:"publish_results",audit_entity:"race"}));
    expect(result.rows.map(row=>row.id)).toEqual([5]);expect(c.calls).toContainEqual(["admin_audit_events","eq","action","publish_results"]);expect(c.calls).toContainEqual(["admin_audit_events","eq","entity_type","race"]);
  });
  it("fetches one selected visible detail and returns only sanitized state previews",async()=>{
    const c=client([row(5),row(4)]);
    const result=await loadAdminAuditLog(c.supabase,parseAdminAuditQuery({audit_event:"4"}));
    expect(c.from).toHaveBeenCalledTimes(2);expect(c.calls).toContainEqual(["admin_audit_events","select","id,actor_profile_id,before_state,after_state"]);expect(c.calls).toContainEqual(["admin_audit_events","eq","id",4]);
    expect(result.detail?.before).toContain("[redacted]");expect(JSON.stringify(result)).not.toContain("fixture-hidden-value");
  });
  it("does not load detail outside the visible filtered page, including the extra paging row",async()=>{
    const c=client(Array.from({length:26},(_,index)=>row(index+1)));
    const result=await loadAdminAuditLog(c.supabase,parseAdminAuditQuery({audit_event:"1"}));
    expect(c.from).toHaveBeenCalledTimes(1);expect(result.detail).toBeNull();expect(result.detailError).toContain("not on this page");
  });
  it("isolates failure messages and keeps the loaded list if detail fails",async()=>{
    for(const option of [{failList:true},{throwList:true}]) {
      const c=client([row(1)],option);const result=await loadAdminAuditLog(c.supabase,parseAdminAuditQuery({audit_event:"1"}));
      expect(result.error).toContain("could not be loaded");expect(result.error).not.toContain("Private");expect(c.from).toHaveBeenCalledTimes(1);
    }
    const c=client([row(1)],{failDetail:true});const result=await loadAdminAuditLog(c.supabase,parseAdminAuditQuery({audit_event:"1"}));
    expect(result.error).toBeNull();expect(result.rows).toHaveLength(1);expect(result.detailError).toContain("state could not be loaded");
  });
  it("handles event deletion and empty old links without asserting history still exists",async()=>{
    const c=client([row(50)]);const result=await loadAdminAuditLog(c.supabase,parseAdminAuditQuery({audit_before:"20"}));
    expect(result.rows).toEqual([]);expect(result.hasOlder).toBe(false);expect(result.hasNewer).toBe(false);
    const html=renderToStaticMarkup(<AdminAuditLog auditLog={result}/>);expect(html).toContain("No events remain on this page");expect(html).toContain("Latest events");
  });
});

describe("audit previews and rendering",()=>{
  it("redacts nested common credentials and signed URLs, leaving useful state intact",()=>{
    const preview=adminAuditStatePreview({role:"admin",nested:{clientSecret:"fixture-value",access_token:"fixture-value",registration_code:"fixture-value",password:"fixture-value",authorization:"fixture-value"},url:"https://example.test/rules.pdf?token=fixture-value#code=fixture-value"});
    expect(preview).not.toContain("fixture-value");expect(preview).toContain('"role": "admin"');expect(preview).toContain("https://example.test/rules.pdf");
  });
  it("bounds deep, large, and circular values and handles absent state explicitly",()=>{
    const circular: Record<string,unknown> = {};circular.self=circular;
    expect(adminAuditStatePreview(circular)).toContain("Preview shortened");
    expect(adminAuditStatePreview(Array.from({length:1000},()=>({label:"long".repeat(1000)}))).length).toBeLessThanOrEqual(6000);
    expect(adminAuditStatePreview(null)).toBe("No state recorded.");
  });
  it("renders accessible filters with cursor-free searches and wrapped lazy details",()=>{
    const html=renderToStaticMarkup(<AdminAuditLog auditLog={data({query:parseAdminAuditQuery({audit_before:"30",audit_event:"29",audit_q:"race"}),rows:[row(29)],detail:{id:29,actorProfileId:null,before:'{"role":"user"}',after:'{"role":"admin"}'},hasNewer:true})}/>);
    expect(html).toContain('method="get"');expect(html).toContain('aria-label="Admin audit history pages"');expect(html).toContain('aria-expanded="true"');expect(html).toContain("Before");expect(html).toContain("After");expect(html).toContain("whitespace-pre-wrap");expect(html).toContain('tabindex="0"');expect(html).not.toContain('name="audit_before"');expect(html).not.toContain('name="audit_event"');
  });
  it("uses valid browser Unicode-set validation patterns",()=>{
    const html=renderToStaticMarkup(<AdminAuditLog auditLog={data()}/>);
    const patterns=[...html.matchAll(/pattern="([^"]+)"/g)].map(match=>match[1]);
    expect(patterns).toHaveLength(2);
    for (const pattern of patterns) {
      const expression=new RegExp(`^(?:${pattern})$`,"v");
      expect(expression.test("publish_results")).toBe(true);
      expect(expression.test("season-update")).toBe(true);
      expect(expression.test("malformed.filter")).toBe(false);
    }
  });
  it("explains empty and unavailable states without presenting an empty success",()=>{
    expect(renderToStaticMarkup(<AdminAuditLog auditLog={data()}/>)).toContain("No admin events have been recorded");
    expect(renderToStaticMarkup(<AdminAuditLog auditLog={data({query:parseAdminAuditQuery({audit_action:"delete"})})}/>)).toContain("No admin events match these filters");
    const html=renderToStaticMarkup(<AdminAuditLog auditLog={data({error:"Audit unavailable"})}/>);expect(html).toContain("Retry audit log");expect(html).not.toContain("No admin events");
  });
});
