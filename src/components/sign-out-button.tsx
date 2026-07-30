import { signOutAction } from "@/app/actions/auth";

type Props = {
  className?: string;
};

export function SignOutButton({ className = "" }: Props) {
  return (
    <form action={signOutAction} className={className}>
      <button
        className="rounded-md border border-red-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 shadow-sm hover:bg-red-50 md:px-3 md:py-2 md:text-sm"
        data-testid="profile-sign-out"
        type="submit"
      >
        Sign out
      </button>
    </form>
  );
}
