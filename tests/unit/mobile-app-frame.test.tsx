import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/picks"
}));

describe("authenticated mobile frame", () => {
  it("mounts one shared navigation and marks the active destination", () => {
    const markup = renderToStaticMarkup(
      <AuthenticatedPageShell eyebrow="Race Picks" title="Pick'em Form">
        <p>Form content</p>
      </AuthenticatedPageShell>
    );

    expect(markup.match(/data-mobile-navigation/g)).toHaveLength(1);
    expect(markup).toContain('href="/picks"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("pb-28");
  });

  it("supports authenticated workspaces that intentionally omit mobile navigation", () => {
    const markup = renderToStaticMarkup(
      <AuthenticatedPageShell
        eyebrow="League Ops"
        showMobileNavigation={false}
        title="Admin Dashboard"
      >
        <p>Admin content</p>
      </AuthenticatedPageShell>
    );

    expect(markup).not.toContain("data-mobile-navigation");
    expect(markup).toContain("pb-10");
  });

});
