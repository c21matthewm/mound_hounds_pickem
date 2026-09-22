export function validInviteCode(value: string): string | null {
  const code = value.trim();
  return code.length >= 8 && code.length <= 64 && !/[\r\n\u0000-\u001f\u007f]/.test(code) ? code : null;
}
export function buildSeasonInviteLink(origin: string, destination: "signup" | "season-registration", rawCode: string): string | null {
  const code = validInviteCode(rawCode);
  if (!code) return null;
  const url = new URL(`/${destination}`, origin);
  if (!["http:", "https:"].includes(url.protocol)) return null;
  // Fragments are available to the recipient's browser, not sent to the server in URLs.
  url.hash = new URLSearchParams({ code }).toString();
  return url.toString();
}
export function inviteCodeFromFragment(fragment: string): string | null {
  return validInviteCode(new URLSearchParams(fragment.replace(/^#/, "")).get("code") ?? "");
}
