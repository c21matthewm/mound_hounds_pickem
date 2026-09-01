type SeasonInviteCodeHelpProps = {
  adminEmail: string;
  seasonYear: number;
};

export function SeasonInviteCodeHelp({
  adminEmail,
  seasonYear
}: SeasonInviteCodeHelpProps) {
  const subject = encodeURIComponent(`Mound Hounds ${seasonYear} season invite code`);

  return (
    <p className="text-xs leading-5 text-slate-500 sm:text-sm">
      Codes are case-sensitive. Don&apos;t know the code? Email the league admins at{" "}
      <a
        className="font-semibold text-cyan-800 underline decoration-cyan-300 underline-offset-2 hover:text-cyan-950"
        href={`mailto:${adminEmail}?subject=${subject}`}
      >
        {adminEmail}
      </a>
      .
    </p>
  );
}
