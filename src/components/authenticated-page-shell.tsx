import type { ReactNode } from "react";

type Props = {
  actions?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  eyebrow: string;
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
    <main className={`mx-auto flex min-h-screen ${maxWidth} flex-col px-5 py-8 pb-24 sm:px-6 md:py-10 md:pb-12`}>
      <header className="border-b border-slate-200 pb-5 md:pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <p className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
              {eyebrow}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
              {title}
            </h1>
            {description ? (
              <div className="mt-2 text-sm leading-6 text-slate-600 md:text-base">{description}</div>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </header>

      {children}
    </main>
  );
}
