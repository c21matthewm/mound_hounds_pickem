import Link from "next/link";

type Props = {
  className?: string;
};

export function ProfileButton({ className = "" }: Props) {
  return (
    <Link
      aria-label="Profile"
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm hover:bg-slate-700 ${className}`}
      href="/profile"
      title="Profile"
    >
      <svg
        aria-hidden
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
      </svg>
      <span className="sr-only">Profile</span>
    </Link>
  );
}
