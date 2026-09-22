// Local component fixtures only. Server actions are replaced by the runner.
// Names, IDs, scores, documents, and email addresses are fictional.
import { createRoot } from 'react-dom/client';
import { AdminDriverPhotoFilter } from '@/components/admin-driver-photo-filter';
import { AdminHistoricalHallOfFameImport } from '@/components/admin-historical-hall-of-fame-import';
import { AdminInviteLinks } from '@/components/admin-invite-links';
import { AdminParticipantBulkControls } from '@/components/admin-participant-bulk-controls';
import { AdminParticipantsWorkspace } from '@/components/admin-participants-workspace';
import { SeasonRecoveryCenter } from '@/components/season-recovery-center';
import { AdminSeasonsWorkspace } from '@/components/admin-seasons-workspace';
import { AdminRulesDocumentUpload } from '@/components/admin-rules-document-upload';
import '@/app/globals.css';
const rows = [{id:1,driverName:'Fixture A',isActive:true,missingPhoto:false,content:<details open><summary>Fixture A editor</summary><input aria-label="Driver draft" defaultValue="Unsaved driver name" /></details>},{id:2,driverName:'Fixture B',isActive:false,missingPhoto:true,content:<p>Fixture B editor</p>}];
const memberId='00000000-0000-4000-8000-000000000001';
const archivedSeason={id:6,season_year:2026,display_name:"2026 Mound Hounds",status:"active",activated_at:null,completed_at:null,registration_code_configured_at:null,roster_configured_at:null,rules_document_url:null};
const nextSeason={...archivedSeason,id:7,season_year:2027,display_name:"2027 Mound Hounds",status:"upcoming"};
const seasonProps={archives:[{id:6,season_year:2026,champion_team_name:"Fixture Champion",champion_total_points:100,participant_count:2,race_count:1,finalized_at:"2026-09-01T00:00:00Z"}],currentSeasonRaces:[],canFinalizeSeason:false,canRefreshArchive:false,finalSeasonRace:undefined,unpublishedSeasonRaces:[],siteOrigin:"https://fixture.example"};
const recoverySeasons=[{id:6,seasonYear:2026,status:'completed'},{id:7,seasonYear:2027,status:'active'}];
const backup={id:'00000000-0000-4000-8000-000000000006',season_id:6,season_year:2026,label:'Before completing 2026 season',source:'pre_rollover',retention_key:'season:6:completion',snapshot_bytes:1024,schema_version:'fixture',format_version:1,row_counts:{races:0},checksum:'fixture',created_at:'2026-09-21T12:00:00Z'};
const scenes = {
 recoveryOffseason:<SeasonRecoveryCenter activeSeason={null} seasons={[recoverySeasons[0]]} selectedSeasonId={6} requestToken="fixture" restorePoints={[backup]} />,
 recoveryPast:<SeasonRecoveryCenter activeSeason={{id:7,seasonYear:2027}} seasons={recoverySeasons} selectedSeasonId={6} requestToken="fixture" restorePoints={[backup]} />,
 recoveryActive:<SeasonRecoveryCenter activeSeason={{id:7,seasonYear:2027}} seasons={recoverySeasons} selectedSeasonId={7} requestToken="fixture" restorePoints={[{...backup,season_id:7,season_year:2027,label:'2027 race checkpoint'}]} />,
 closeout:<AdminSeasonsWorkspace {...seasonProps} activeSeason={archivedSeason} seasons={[archivedSeason,nextSeason]} />,
 offseason:<AdminSeasonsWorkspace {...seasonProps} activeSeason={null} seasons={[{...archivedSeason,status:"completed"},nextSeason]} />,
 drivers:<AdminDriverPhotoFilter entries={rows} />,
 historical:<AdminHistoricalHallOfFameImport archivedYears={[2025,2026]} />,
 invite:<AdminInviteLinks siteOrigin="https://fixture.example" />,
 participants:<AdminParticipantsWorkspace currentAdminId="00000000-0000-4000-8000-000000000002" activeSeasonYear={2027} activeSeasonId={7} participantSeasons={[{id:7,seasonYear:2027,status:'active'},{id:8,seasonYear:2028,status:'upcoming'}]} selectedParticipantSeasonId={8} participants={[{id:memberId,fullName:'Fixture Member',teamName:'Fixture Team',email:'fixture@example.test',isActive:true,pickCount:1,registered:true,enrollmentStatus:null,role:'participant'}]} />,
 bulk:<AdminParticipantBulkControls participants={[{profile_id:memberId,expected_is_active:true,expected_status:null}]} selectedSeason={{id:8,seasonYear:2028}} onComplete={()=>{}} onClear={()=>{}} />,
 rules:<AdminRulesDocumentUpload seasonId={7} seasonYear={2027} currentUrl={null} />
};
window.fixtureScenes=Object.keys(scenes);
const root = createRoot(document.getElementById('root'));
window.showScene=(name)=>root.render(<main className="mx-auto min-w-0 max-w-7xl p-4">{scenes[name]}</main>);
