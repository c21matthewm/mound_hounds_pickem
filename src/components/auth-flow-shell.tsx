import type { ReactNode } from "react";
import { MOUND_HOUND_IMAGE_PATH } from "@/lib/branding";

type AuthFlowShellProps = {
  action?: ReactNode;
  children: ReactNode;
  description: ReactNode;
  eyebrow?: string;
  footer?: ReactNode;
  maxWidth?: string;
  title: string;
};

export function AuthFlowShell({
  action,
  children,
  description,
  eyebrow = "Mound Hounds Pick'em League",
  footer,
  maxWidth = "max-w-lg",
  title
}: AuthFlowShellProps) {
  return (
    <main
      className={`mx-auto flex min-h-screen w-full ${maxWidth} flex-col justify-center px-5 py-12 sm:px-6 sm:py-16`}
    >
      <header className="grid grid-cols-[4.25rem_minmax(0,1fr)_auto] items-start gap-3">
        <div
          aria-hidden
          className="h-[4.25rem] w-[4.25rem] rounded-lg border border-slate-200 bg-slate-200 bg-cover bg-center shadow-sm"
          style={{
            backgroundImage: `url('${MOUND_HOUND_IMAGE_PATH}')`,
            backgroundPosition: "50% 38%"
          }}
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">
            {eyebrow}
          </p>
          <h1 className="mt-1 break-words text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            {title}
          </h1>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>

      <div className="mt-3 text-sm leading-6 text-slate-600">{description}</div>
      {children}
      {footer ? <footer className="mt-5 text-sm text-slate-600">{footer}</footer> : null}
    </main>
  );
}

type AuthFormPanelProps = {
  children: ReactNode;
  className?: string;
};

export function AuthFormPanel({ children, className = "" }: AuthFormPanelProps) {
  return (
    <div className={`mt-6 rounded-lg ui-panel border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}
