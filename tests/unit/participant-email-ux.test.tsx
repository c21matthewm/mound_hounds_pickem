import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SeasonInviteCodeHelp } from "@/components/season-invite-code-help";

describe("participant email UX", () => {
  it("links season-code questions to the configured league address", () => {
    const markup = renderToStaticMarkup(
      <SeasonInviteCodeHelp
        adminEmail="league@example.com"
        seasonYear={2027}
      />
    );

    expect(markup).toContain("Codes are case-sensitive.");
    expect(markup).toContain("Don&#x27;t know the code?");
    expect(markup).toContain("league@example.com");
    expect(markup).toContain(
      "mailto:league@example.com?subject=Mound%20Hounds%202027%20season%20invite%20code"
    );
  });

  it("keeps the branded recovery template connected to Supabase's secure link", () => {
    const template = readFileSync("supabase/templates/password-recovery.html", "utf8");

    expect(template).toContain("Mound Hounds Pick'em");
    expect(template).toContain('href="{{ .ConfirmationURL }}"');
    expect(template).toContain("{{ .Email }}");
    expect(template).not.toContain("TEST EMAIL");
  });

  it("keeps the branded signup template connected to Supabase's confirmation link", () => {
    const template = readFileSync("supabase/templates/signup-confirmation.html", "utf8");

    expect(template).toContain("Mound Hounds Pick'em");
    expect(template).toContain('href="{{ .ConfirmationURL }}"');
    expect(template).toContain("{{ .Email }}");
    expect(template).not.toContain("TEST EMAIL");
  });

  it("keeps confirmation resend help in account creation instead of sign in", () => {
    const loginPage = readFileSync("src/app/login/page.tsx", "utf8");
    const signupPage = readFileSync("src/app/signup/page.tsx", "utf8");

    expect(loginPage).not.toContain('href="/resend-confirmation"');
    expect(signupPage).toContain('href="/resend-confirmation"');
  });
});
