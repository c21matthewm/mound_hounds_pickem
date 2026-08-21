import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { MobileActionDock } from "@/components/mobile-action-dock";

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

  it("keeps action docks above the shared navigation and device safe area", () => {
    const markup = renderToStaticMarkup(
      <MobileActionDock>
        <button type="button">Save</button>
      </MobileActionDock>
    );
    const css = readFileSync("src/app/globals.css", "utf8");

    expect(markup).toContain("data-mobile-action-dock");
    expect(markup).toContain("mobile-action-dock");
    expect(css).toContain(".mobile-bottom-navigation");
    expect(css).toContain("bottom: 0.75rem");
    expect(css).toContain(".mobile-action-dock");
    expect(css).toContain("bottom: 4.25rem");
    expect(css).toContain("--mobile-navigation-bottom: var(--mobile-edge-spacing)");
    expect(css).toContain("var(--mobile-navigation-height) + 0.25rem");
  });
});
