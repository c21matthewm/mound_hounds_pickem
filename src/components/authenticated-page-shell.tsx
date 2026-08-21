import type { ReactNode } from "react";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { ProfileButton } from "@/components/profile-button";

type Props = {
  actions?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  eyebrow: string;
  maxWidth?: string;
  showMobileNavigation?: boolean;
  title: string;
};

export function AuthenticatedPageShell({
  actions,
  children,
  description,
  eyebrow,
  maxWidth = "max-w-6xl",
  showMobileNavigation = true,
  title
}: Props) {
  return (
    <main
      className={`mx-auto flex min-h-screen w-full min-w-0 ${maxWidth} flex-col px-4 py-6 ${showMobileNavigation ? "pb-28" : "pb-10"} sm:px-6 sm:py-8 md:py-10 md:pb-12`}
    >
      <header className="border-b border-slate-200 pb-5 md:pb-6">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:gap-4">
          <div className="min-w-0 max-w-3xl">
            <p className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
              {eyebrow}
            </p>
            <h1 className="mt-3 break-words text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
              {title}
            </h1>
            {description ? (
              <div className="mt-2 text-sm leading-6 text-slate-600 md:text-base">{description}</div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
            <ProfileButton />
          </div>
        </div>
      </header>

      {children}
      {showMobileNavigation ? <MobileBottomNav /> : null}
    </main>
  );
}
