import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import {
  ActionAnchor,
  ActionLink,
  CompactNotice,
  ContentPanel
} from "@/components/ui-primitives";
import { requireAppUser } from "@/lib/authenticated-user";

export default async function RulesPage() {
  const { activeSeason } = await requireAppUser({ requireSeasonDecision: true });
  const rulesPdfPath =
    activeSeason?.rulesDocumentUrl ??
    (activeSeason?.seasonYear === 2026
      ? "/docs/2026-mound-hounds-rules-and-regulations.pdf"
      : null);

  return (
    <AuthenticatedPageShell
      actions={
        <ActionLink href="/dashboard" variant="secondary">
          Dashboard
        </ActionLink>
      }
      description={`Official Mound Hounds Pick'em league rules${
        activeSeason ? ` for ${activeSeason.seasonYear}` : ""
      }.`}
      eyebrow="League Docs"
      maxWidth="max-w-[1200px]"
      title="Rules & Regulations"
    >

      {rulesPdfPath ? (
        <ContentPanel className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-slate-700">
              The PDF is shown below. Open it in a new tab if your browser does not display it.
            </p>
            <ActionAnchor href={rulesPdfPath} rel="noreferrer" target="_blank">
              Open PDF
            </ActionAnchor>
          </div>

          <div className="mt-4 h-[70vh] overflow-hidden rounded-md ui-panel-muted border border-slate-200 bg-slate-50">
            <iframe
              className="h-full w-full"
              src={`${rulesPdfPath}#view=FitH`}
              title="Mound Hounds Pick'em Rules and Regulations"
            />
          </div>
        </ContentPanel>
      ) : (
        <CompactNotice className="mt-6">
          The rules document for this season has not been posted yet.
        </CompactNotice>
      )}
    </AuthenticatedPageShell>
  );
}
