import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminParticipantsWorkspace, type AdminParticipantRow } from "@/components/admin-participants-workspace";

vi.mock("@/app/admin/participant-bulk-actions", () => ({ bulkUpdateParticipantsAction: async () => ({ok:false,message:""}) }));
vi.mock("@/app/admin/season-actions", () => ({ updateParticipantAction: async () => {} }));
vi.mock("@/components/submit-button", () => ({ SubmitButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button> }));
vi.mock("@/components/admin-participant-role-controls", () => ({ AdminParticipantRoleControls: () => <div>Role controls</div> }));
const participants: AdminParticipantRow[] = [
  { id: "admin", email: "organizer@example.test", fullName: "Fixture Admin", isActive: true, pickCount: 0, registered: true, role: "admin", teamName: "Admin team" },
  { id: "member", email: "a-long-participant-address@example.test", fullName: "Fixture Member", isActive: true, pickCount: 2, registered: true, role: "participant", teamName: "Member team" }
];
const render = (props: Partial<React.ComponentProps<typeof AdminParticipantsWorkspace>> = {}) => renderToStaticMarkup(
  <AdminParticipantsWorkspace activeSeasonYear={2027} currentAdminId="admin" participants={participants} {...props} />
);

describe("participant directory emails", () => {
  it("shows emails in collapsed summaries with wrapping for mobile", () => {
    const html = render();
    expect(html.indexOf("organizer@example.test")).toBeLessThan(html.indexOf("</summary>"));
    expect(html).toContain('class="block break-all"');
    expect(html).toContain("a-long-participant-address@example.test");
  });
  it("filters by email without exposing unrelated account rows", () => {
    const html = render({ initialQuery: "LONG-PARTICIPANT" });
    expect(html).toContain("Member team");
    expect(html).not.toContain("Admin team");
    expect(html).toContain("1 matching accounts");
  });
  it("keeps profile controls and a status warning available when emails fail", () => {
    const html = render({ participants: participants.map(participant => ({...participant, email: undefined})), emailWarning: "Email lookup is temporarily unavailable." });
    expect(html).toContain('role="status"');
    expect(html).toContain("Email lookup is temporarily unavailable");
    expect(html).toContain("Email: Unavailable");
    expect(html).toContain("Save participant");
  });
});


describe("explicit season enrollment selection", () => {
  const upcoming = {participantSeasons:[{id:42,seasonYear:2027,status:"active" as const},{id:43,seasonYear:2028,status:"upcoming" as const}],selectedParticipantSeasonId:43};
  it("shows the selected upcoming decision without replacing active-season profile controls", () => {
    const html=render({...upcoming,participants:participants.map(participant=>({...participant,enrollmentStatus:"declined"}))});
    expect(html).toContain('name="participant_season_id"');
    expect(html).toContain("Register for 2028");
    expect(html).toContain("Mark declined for 2028");
    expect(html).toContain("0 registered / 2 accounts");
    expect(html).toContain("Registered 2027");
    expect(html).toContain("Declined");
    expect(html).toContain("Allow forced removal from scoring despite 2 submitted races");
  });
  it("filters by the selected season decision rather than active-season registration", () => {
    const html=render({...upcoming,initialStatus:"registered",participants:participants.map(participant=>({...participant,enrollmentStatus:null}))});
    expect(html).toContain("No matching participant accounts");
    expect(html).not.toContain("Save participant");
  });
  it("supports a declined-season filter", () => {
    const html=render({...upcoming,initialStatus:"declined",participants:participants.map((participant,index)=>({...participant,enrollmentStatus:index===0?"declined":null}))});
    expect(html).toContain("Admin team"); expect(html).not.toContain("Member team");
  });
  it("offers separate bounded selection without removing individual edits or role controls", () => {
    const html=render();
    expect(html).toContain("Select accounts on this page");
    expect(html).toContain("Selected accounts (0/100)");
    expect(html).toContain("Save participant");
    expect(html).toContain("Role controls");
    expect(html).toContain("Apply to selected");
  });
});
