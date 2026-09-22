import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminParticipantRoleControls } from "@/components/admin-participant-role-controls";

vi.mock("@/app/admin/role-actions", () => ({ updateParticipantRoleAction: async () => {} }));
vi.mock("@/components/confirm-submit-button", () => ({
  ConfirmSubmitButton: ({ children, disabled, confirmMessage }: { children: React.ReactNode; disabled: boolean; confirmMessage: string }) => (
    <button disabled={disabled} data-confirm={confirmMessage}>{children}</button>
  )
}));

const base = { currentRole: "participant" as const, hasOtherEligibleAdmin: true, isCurrentAdmin: false, profileComplete: true, profileId: "member-id", teamName: "Fixture Team" };
describe("participant role controls", () => {
  it("makes the grant and its permissions explicit in confirmation", () => {
    const html = renderToStaticMarkup(<AdminParticipantRoleControls {...base} />);
    expect(html).toContain("Promote to Admin");
    expect(html).toContain("Grant admin access to Fixture Team?");
    expect(html).toContain("Only grant these permissions to someone you trust");
    expect(html).toContain('name="expected_role" value="participant"');
    expect(html).not.toContain('disabled=""');
  });
  it("shows why the current admin cannot demote themselves", () => {
    const html = renderToStaticMarkup(<AdminParticipantRoleControls {...base} currentRole="admin" isCurrentAdmin />);
    expect(html).toContain("You cannot remove your own admin access");
    expect(html).toContain('disabled=""');
  });
  it("disables demotion when there is no other eligible administrator", () => {
    const html = renderToStaticMarkup(<AdminParticipantRoleControls {...base} currentRole="admin" hasOtherEligibleAdmin={false} />);
    expect(html).toContain("Another admin with participation enabled is required");
    expect(html).toContain('disabled=""');
  });
  it("requires a complete profile before promotion and separates participation from access", () => {
    const html = renderToStaticMarkup(<AdminParticipantRoleControls {...base} profileComplete={false} />);
    expect(html).toContain("Save this participant’s name and team");
    expect(html).toContain("Participation eligibility and season registration are separate from admin access");
    expect(html).toContain('disabled=""');
  });
});
