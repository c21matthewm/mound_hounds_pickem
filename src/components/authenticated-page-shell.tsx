import type { ReactNode } from "react";
import { DesktopPrimaryNav } from "@/components/desktop-primary-nav";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { ProfileButton } from "@/components/profile-button";

type Props = {
  actions?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  maxWidth?: string;
  title: string;
};

export function AuthenticatedPageShell({
  actions,
  children,
  description,
  eyebrow,
  maxWidth = "max-w-6xl",
  title
}: Props) {
  return (
    <main
      className={`app-page-width mx-auto flex min-h-svh w-full min-w-0 ${maxWidth} flex-col px-4 py-6 pb-28 sm:px-6 sm:py-8 md:py-10 md:pb-12`}
    >
      <header className="border-b border-slate-200 pb-5 md:pb-6">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:gap-4">
          <div className="min-w-0 max-w-3xl">
            {eyebrow ? (
              <p className="mb-1 text-xs font-semibold tracking-wide text-slate-600">{eyebrow}</p>
            ) : null}
            <h1 className="break-words text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
              {title}
            </h1>
            {description ? (
              <div className="mt-2 text-sm leading-6 text-slate-600 md:text-base">{description}</div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <DesktopPrimaryNav />
            {actions}
            <ProfileButton />
          </div>
        </div>
      </header>

      {children}
      <MobileBottomNav />
    </main>
  );
}
