import type { ReactNode } from "react";
import { ContentPanel, StatusChip, type StatusTone } from "@/components/ui-primitives";
import { formatLeagueDateTime } from "@/lib/timezone";

type Props = {
  action?: ReactNode;
  mascot?: string;
  banner?: string | null;
  children?: ReactNode;
  context?: string;
  description?: string;
  timing?: { label: string; dateTime: string };
  status: string;
  title: string;
  tone: StatusTone;
};

export function RaceWeekSummary({ action, banner, children, context, description, mascot, status, timing, title, tone }: Props) {
  return (
    <ContentPanel aria-labelledby="race-week-title" className="mt-5 min-w-0 overflow-hidden">
      {banner ? (
        <div className="-mx-4 -mt-4 mb-4 bg-slate-100 sm:-mx-5 sm:-mt-5 sm:mb-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" className="block h-auto max-h-[75svh] w-full object-contain" decoding="async" src={banner} />
        </div>
      ) : null}
      <div className="flex min-w-0 items-start justify-between gap-3 sm:gap-5">
        <div className="min-w-0">
          {context ? <p className="text-xs font-semibold tracking-wide text-slate-600">{context}</p> : null}
          <h2 className="break-words text-xl font-semibold leading-tight text-slate-950 sm:text-2xl" id="race-week-title">
            {title}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusChip tone={tone}><span className="sr-only">Status: </span>{status}</StatusChip>
            {timing ? (
              <p className="text-sm leading-snug text-slate-700">
                <span className="font-semibold">{timing.label}</span>{" · "}
                <time dateTime={timing.dateTime}>
                  {formatLeagueDateTime(timing.dateTime, { dateStyle: "medium", timeStyle: "short" })}
                </time>
              </p>
            ) : null}
          </div>
        </div>
        {mascot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className="size-20 shrink-0 rounded-md object-contain sm:size-28"
            decoding="async"
            height={112}
            src={mascot}
            width={112}
          />
        ) : null}
      </div>
      {description || action ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {description ? <p className="max-w-prose text-sm leading-6 text-slate-600">{description}</p> : null}
          {action}
        </div>
      ) : null}
      {children ? <div className="mt-3 border-t border-slate-200 pt-3">{children}</div> : null}
    </ContentPanel>
  );
}
