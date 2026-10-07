import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SeasonRecoveryCenter } from "@/components/season-recovery-center";
import type { SeasonRestorePointSummary } from "@/lib/season-recovery";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const point: SeasonRestorePointSummary = {id:"fixture",season_id:6,season_year:2026,label:"Before completing 2026",source:"pre_rollover",retention_key:"season:6:completion",snapshot_bytes:1024,schema_version:"fixture",format_version:1,row_counts:{},checksum:"fixture",created_at:"2026-09-21T12:00:00Z"};
const seasons = [{id:6,seasonYear:2026,status:"completed" as const},{id:7,seasonYear:2027,status:"active" as const}];
describe("Recovery across season boundaries", () => {
  it.each([null,{id:7,seasonYear:2027}])("keeps completed-season backups visible when another or no season is active (%j)", activeSeason => {
    const html = renderToStaticMarkup(<SeasonRecoveryCenter activeSeason={activeSeason} seasons={seasons} selectedSeasonId={6} requestToken="fixture" restorePoints={[point]} />);
    expect(html).toContain("Before completing 2026");
    expect(html).toContain("Preview Restore");
    expect(html).toContain('name="recovery_season_id"');
    expect(html).toContain("Saved backups remain available");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Create &amp; Download Backup/);
  });
  it("still offers a fresh backup when viewing the active season", () => {
    const html=renderToStaticMarkup(<SeasonRecoveryCenter activeSeason={{id:7,seasonYear:2027}} seasons={seasons} selectedSeasonId={7} requestToken="fixture" restorePoints={[]} />);
    const button=html.match(/<button[^>]*>Create &amp; Download Backup/);
    expect(button).not.toBeNull();
    expect(button![0]).not.toContain('disabled=""');
  });
});

const retention = {seasonId:6,seasonYear:2026,routineLimit:3,totalCount:6,totalBytes:6144,routineCount:5,protectedCount:1,cleanupCount:2,cleanupBytes:2048,reviewToken:"a".repeat(64)};
describe("routine recovery retention controls",()=>{
  it("shows full totals independently of the bounded selector and offers completed-season cleanup",()=>{
    const html=renderToStaticMarkup(<SeasonRecoveryCenter activeSeason={null} seasons={seasons} selectedSeasonId={6} requestToken="fixture" restorePoints={[point]} retention={retention}/>);
    expect(html).toContain("all 6 points");expect(html).toContain("Review older backups");expect(html).toContain("Snapshot data");expect(html).not.toContain("Keep permanently</button>");
  });
  it("preserves existing recovery flows when retention has not been installed",()=>{
    const html=renderToStaticMarkup(<SeasonRecoveryCenter activeSeason={{id:7,seasonYear:2027}} seasons={seasons} selectedSeasonId={7} requestToken="fixture" restorePoints={[]} retentionIssue="Apply the pending migration."/>);
    expect(html).toContain("Existing downloads, imports, and restores remain available");expect(html).not.toContain("Review older backups");
    const create=html.match(/<button[^>]*>Create &amp; Download Backup/);expect(create).not.toBeNull();expect(create![0]).not.toContain('disabled=""');
  });
  it("shows permanent protection only for manual backups",()=>{
    const manual={...point,source:"manual" as const,retention_key:null};
    const render=(backup:SeasonRestorePointSummary)=>renderToStaticMarkup(<SeasonRecoveryCenter activeSeason={null} seasons={seasons} selectedSeasonId={6} requestToken="fixture" restorePoints={[backup]} retention={retention}/>);
    expect(render(manual)).toContain("Keep permanently</button>");
    expect(render({...manual,retention_key:"manual:protected"})).toContain("Return to routine retention");
    expect(render(point)).not.toContain("Return to routine retention");
  });
});
