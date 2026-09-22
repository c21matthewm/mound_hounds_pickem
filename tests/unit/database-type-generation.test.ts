import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const generator = fileURLToPath(new URL("../../scripts/generate-supabase-types.mjs", import.meta.url));
const temporaryDirectories: string[] = [];
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) rmSync(directory, {recursive:true, force:true}); });
const rpc = (properties: Record<string, {type:string}>) => ({post:{parameters:[{in:"body",name:"args",schema:{type:"object",required:Object.keys(properties),properties}}],responses:{"200":{schema:{format:"jsonb"}}}}});
const contract = () => ({
  definitions:{fixture:{required:["id"],properties:{id:{type:"integer"},label:{type:"string"}}}},
  paths:{
    "/rpc/admin_bulk_update_participants":rpc({p_operation:{type:"string"},p_participants:{type:"object"},p_season_id:{type:"integer"}}),
    "/rpc/admin_update_participant_v2":rpc({p_expected_season_id:{type:"integer"},p_profile_id:{type:"string"}}),
    "/rpc/set_league_season_rules_document":rpc({p_expected_rules_document_url:{type:"string"},p_rules_document_url:{type:"string"},p_season_id:{type:"integer"}}),
    "/rpc/unrelated_function":rpc({p_name:{type:"string"}})
  }
});
function fixture(document: unknown) {
  const directory=mkdtempSync(path.join(tmpdir(),"mound-type-generator-"));temporaryDirectories.push(directory);
  mkdirSync(path.join(directory,"src/lib/supabase"),{recursive:true});
  const documentPath=path.join(directory,"contract.json");writeFileSync(documentPath,JSON.stringify(document));
  const hook=path.join(directory,"offline-fetch.mjs");
  writeFileSync(hook,`import {readFileSync} from 'node:fs';
    globalThis.fetch=async (url,options)=>{
      if(url!=='https://schema.fixture.invalid/rest/v1/' || options?.method) throw new Error('Unexpected schema request');
      return new Response(readFileSync(${JSON.stringify(documentPath)},'utf8'),{headers:{'Content-Type':'application/json'}});
    };`);
  const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:"https://schema.fixture.invalid",SUPABASE_SERVICE_ROLE_KEY:"fictional-test-key"};
  const run=(check=false)=>spawnSync(process.execPath,["--import",hook,generator,...(check?["--check"]:[])],{cwd:directory,env,encoding:"utf8",timeout:10_000});
  const outputPath=path.join(directory,"src/lib/supabase/database.types.ts");
  return {run,outputPath};
}

describe("database type generation",()=>{
  it("preserves SQL-supported null arguments without making required keys optional",()=>{
    const test=fixture(contract());const result=test.run();expect(result.status,result.stderr).toBe(0);
    const output=readFileSync(test.outputPath,"utf8");
    expect(output).toContain('"p_expected_rules_document_url": string | null');
    expect(output).toContain('"p_rules_document_url": string | null');
    expect(output).toContain('"p_season_id": number | null');
    expect(output).not.toContain('"p_season_id"?:');
    expect(output).toContain('"p_expected_season_id": number | null');
    expect(output).not.toContain('"p_expected_season_id"?:');
    expect(output).toContain('"p_profile_id": string\n');
    const rules=output.slice(output.indexOf('"set_league_season_rules_document"'),output.indexOf('"unrelated_function"'));
    expect(rules).toContain('"p_season_id": number\n');
    expect(rules).not.toContain('"p_season_id": number | null');
    expect(output).toContain('"p_name": string\n');
    expect(output).not.toContain('"p_name": string | null');
    expect(test.run(true).status).toBe(0);
    writeFileSync(test.outputPath,output+'// stale\n');
    expect(test.run(true).status).toBe(1);
  });
  it("fails before overwriting the local file when a refined argument changes type",()=>{
    const document=contract();document.paths["/rpc/admin_bulk_update_participants"].post.parameters[0].schema.properties.p_season_id={type:"string"};
    const test=fixture(document);writeFileSync(test.outputPath,"previous contract");
    const result=test.run();expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Review RPC nullability refinement: admin_bulk_update_participants.p_season_id");
    expect(readFileSync(test.outputPath,"utf8")).toBe("previous contract");
  });
  it("does not invent functions that are missing from the deployed schema",()=>{
    const test=fixture({definitions:{},paths:{}});expect(test.run().status).toBe(0);
    expect(readFileSync(test.outputPath,"utf8")).not.toContain('"admin_bulk_update_participants"');
  });
});
