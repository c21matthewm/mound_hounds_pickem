import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import InstallPage from "@/app/install/page";
import LeagueInstallPage from "@/app/more/install/page";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } })
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(path); },
  usePathname: () => "/more/install"
}));

describe("install guide navigation", () => {
  it("keeps the guide accessible from sign-in without a session", () => {
    const html = renderToStaticMarkup(<InstallPage />);
    expect(html).toContain("iPhone and iPad");
    expect(html).toContain("What works offline?");
    expect(html).not.toContain("data-mobile-navigation");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("shows the same guide with the shared navigation inside the league", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: "fixture" } } });
    const html = renderToStaticMarkup(await LeagueInstallPage());
    expect(html).toContain("iPhone and iPad");
    expect(html).toContain("What works offline?");
    expect(html).toContain("data-mobile-navigation");
    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('href="/more"');
  });

  it("sends signed-out visitors of the league guide to sign-in", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });
    await expect(LeagueInstallPage()).rejects.toThrow("/login?next=%2Fmore%2Finstall");
  });
});
