import Link from "next/link";
import type {
  ButtonHTMLAttributes,
  ComponentPropsWithoutRef,
  HTMLAttributes,
  ReactNode
} from "react";

export type StatusTone = "info" | "neutral" | "success" | "warning" | "danger";

const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  danger: "ui-status-danger border-red-200 bg-red-50 text-red-700",
  info: "border-cyan-200 bg-cyan-50 text-cyan-800",
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  success: "ui-status-success border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "ui-status-warning border-amber-200 bg-amber-50 text-amber-800"
};

type StatusChipProps = ComponentPropsWithoutRef<"span"> & {
  tone?: StatusTone;
};

export function StatusChip({
  children,
  className = "",
  tone = "neutral",
  ...props
}: StatusChipProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_TONE_CLASSES[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

type RankBadgeProps = ComponentPropsWithoutRef<"span"> & {
  rank: number;
  showNumberSign?: boolean;
};

export function RankBadge({
  className = "",
  rank,
  showNumberSign = false,
  ...props
}: RankBadgeProps) {
  const podiumClassName =
    rank === 1
      ? "border-amber-300 bg-amber-100 text-amber-900"
      : rank === 2
        ? "border-slate-300 bg-slate-100 text-slate-700"
        : rank === 3
          ? "border-orange-300 bg-orange-100 text-orange-900"
          : "border-transparent text-slate-700";

  return (
    <span
      className={`inline-flex h-6 min-w-7 items-center justify-center rounded-full border px-1 text-xs font-bold tabular-nums ${podiumClassName} ${className}`}
      {...props}
    >
      {showNumberSign ? "#" : ""}
      {rank}
    </span>
  );
}

export type ActionVariant = "primary" | "secondary" | "quiet";

type ActionLinkProps = {
  children: ReactNode;
  className?: string;
  href: string;
  variant?: ActionVariant;
};

const ACTION_BASE_CLASSES =
  "inline-flex min-h-10 items-center justify-center rounded-md px-3 py-2 text-sm font-semibold transition";

const ACTION_VARIANT_CLASSES = {
  primary: "ui-action-primary bg-slate-900 text-white shadow-sm hover:bg-slate-700",
  quiet: "text-slate-700 hover:bg-slate-100 hover:text-slate-950",
  secondary:
    "ui-action-secondary ui-control-border border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
};

export function actionControlClassName(
  variant: ActionVariant = "primary",
  className = ""
): string {
  return `${ACTION_BASE_CLASSES} ${ACTION_VARIANT_CLASSES[variant]} ${className}`;
}

export function ActionLink({
  children,
  className = "",
  href,
  variant = "primary"
}: ActionLinkProps) {
  return (
    <Link
      className={actionControlClassName(variant, className)}
      href={href}
    >
      {children}
    </Link>
  );
}

type ActionAnchorProps = ComponentPropsWithoutRef<"a"> & {
  variant?: ActionVariant;
};

export function ActionAnchor({
  children,
  className = "",
  variant = "primary",
  ...props
}: ActionAnchorProps) {
  return (
    <a className={actionControlClassName(variant, className)} {...props}>
      {children}
    </a>
  );
}

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ActionVariant;
};

export function ActionButton({
  children,
  className = "",
  type = "button",
  variant = "primary",
  ...props
}: ActionButtonProps) {
  return (
    <button
      className={actionControlClassName(
        variant,
        `disabled:cursor-not-allowed disabled:opacity-50 ${className}`
      )}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

type SectionHeaderProps = {
  action?: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  title: string;
};

export function SectionHeader({
  action,
  description,
  eyebrow,
  title
}: SectionHeaderProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">{eyebrow}</p>
        ) : null}
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        {description ? <div className="mt-1 text-sm text-slate-600">{description}</div> : null}
      </div>
      {action}
    </div>
  );
}

type ContentPanelProps = ComponentPropsWithoutRef<"section">;

export function ContentPanel({
  children,
  className = "",
  ...props
}: ContentPanelProps) {
  return (
    <section
      className={`ui-panel rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}
      {...props}
    >
      {children}
    </section>
  );
}

export const FIELD_CONTROL_CLASSES =
  "ui-control-border w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";

export function fieldControlClassName(className = ""): string {
  return `${FIELD_CONTROL_CLASSES} ${className}`;
}

type FormFieldProps = {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  label: ReactNode;
  labelClassName?: string;
};

export function FormField({
  children,
  className = "",
  description,
  label,
  labelClassName = ""
}: FormFieldProps) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span
        className={`mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600 ${labelClassName}`}
      >
        {label}
      </span>
      {children}
      {description ? (
        <span className="mt-1.5 block text-xs leading-5 text-slate-500">{description}</span>
      ) : null}
    </label>
  );
}

export type RouteTabItem = {
  active: boolean;
  href: string;
  label: string;
  testId?: string;
};

type RouteTabsProps = {
  ariaLabel: string;
  className?: string;
  items: RouteTabItem[];
  layout?: "grid" | "scroll";
};

export function RouteTabs({
  ariaLabel,
  className = "",
  items,
  layout = "grid"
}: RouteTabsProps) {
  return (
    <nav aria-label={ariaLabel} className={className}>
      <ul
        className={
          layout === "scroll"
            ? "ui-panel flex w-max min-w-full gap-1 rounded-md border border-slate-200 bg-white p-1"
            : "ui-panel grid w-full grid-cols-2 gap-1 rounded-md border border-slate-200 bg-white p-1 sm:flex sm:w-fit"
        }
      >
        {items.map((item) => (
          <li className={layout === "scroll" ? "shrink-0" : "min-w-0"} key={item.href}>
            <Link
              aria-current={item.active ? "page" : undefined}
              className={`flex min-h-10 items-center justify-center rounded px-3 py-2 text-center text-sm font-semibold ${
                item.active
                  ? "ui-action-primary bg-slate-900 text-white shadow-sm"
                  : "text-slate-700 hover:bg-slate-100 hover:text-slate-950"
              }`}
              data-testid={item.testId}
              href={item.href}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

type DisclosureProps = ComponentPropsWithoutRef<"details"> & {
  description?: ReactNode;
  meta?: ReactNode;
  summary: ReactNode;
};

export function Disclosure({
  children,
  className = "",
  description,
  meta,
  summary,
  ...props
}: DisclosureProps) {
  return (
    <details
      className={`ui-panel group rounded-md border border-slate-200 bg-white ${className}`}
      {...props}
    >
      <summary className="cursor-pointer px-4 py-3 marker:text-slate-400">
        <span className="ml-1 inline-flex min-w-0 max-w-[calc(100%-1.25rem)] align-middle">
          <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-900">{summary}</span>
              {description ? (
                <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                  {description}
                </span>
              ) : null}
            </span>
            {meta ? <span className="shrink-0">{meta}</span> : null}
          </span>
        </span>
      </summary>
      <div className="border-t border-slate-200 p-4">{children}</div>
    </details>
  );
}

type EmptyStateProps = {
  action?: ReactNode;
  className?: string;
  description: ReactNode;
  title: string;
};

export function EmptyState({
  action,
  className = "",
  description,
  title
}: EmptyStateProps) {
  return (
    <div
      className={`ui-empty-surface rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center ${className}`}
    >
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="mx-auto mt-1 max-w-xl text-sm leading-6 text-slate-600">{description}</div>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

type PaginationProps = {
  className?: string;
  currentPage: number;
  itemLabel?: string;
  onNext: () => void;
  onPrevious: () => void;
  pageCount: number;
  rangeEnd?: number;
  rangeStart?: number;
  totalItems?: number;
};

export function Pagination({
  className = "",
  currentPage,
  itemLabel = "items",
  onNext,
  onPrevious,
  pageCount,
  rangeEnd,
  rangeStart,
  totalItems
}: PaginationProps) {
  return (
    <nav
      aria-label={`${itemLabel} pages`}
      className={`flex min-h-12 items-center justify-between gap-3 border-t border-slate-200 px-3 py-2.5 ${className}`}
    >
      <ActionButton
        className="min-h-9 px-3 py-1.5 text-xs"
        disabled={currentPage <= 1}
        onClick={onPrevious}
        variant="secondary"
      >
        Previous
      </ActionButton>
      <div className="text-center text-xs font-medium text-slate-600">
        <p>
          Page {currentPage} of {pageCount}
        </p>
        {rangeStart !== undefined && rangeEnd !== undefined && totalItems !== undefined ? (
          <p className="mt-0.5 text-[11px] font-normal text-slate-500">
            {rangeStart}-{rangeEnd} of {totalItems} {itemLabel}
          </p>
        ) : null}
      </div>
      <ActionButton
        className="min-h-9 px-3 py-1.5 text-xs"
        disabled={currentPage >= pageCount}
        onClick={onNext}
        variant="secondary"
      >
        Next
      </ActionButton>
    </nav>
  );
}

type DataSurfaceProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  description?: ReactNode;
  eyebrow?: string;
  meta?: ReactNode;
  title: ReactNode;
};

export function DataSurface({
  children,
  className = "",
  description,
  eyebrow,
  meta,
  title,
  ...props
}: DataSurfaceProps) {
  return (
    <section
      className={`ui-panel overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}
      {...props}
    >
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3 border-b border-slate-800 bg-slate-950 px-4 py-3 text-white">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-200">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <div className="mt-0.5 text-xs text-slate-300">{description}</div> : null}
        </div>
        {meta ? <div className="shrink-0">{meta}</div> : null}
      </header>
      {children}
    </section>
  );
}

export type MetricStripItem = {
  label: string;
  value: ReactNode;
};

type MetricStripProps = {
  className?: string;
  items: MetricStripItem[];
};

export function MetricStrip({ className = "", items }: MetricStripProps) {
  return (
    <dl
      className={`grid gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 ${className}`}
    >
      {items.map((item) => (
        <div className="min-w-0 bg-white px-3 py-2.5" key={item.label}>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {item.label}
          </dt>
          <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums text-slate-950">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type DetailGridItem = {
  label: string;
  value: ReactNode;
  valueClassName?: string;
};

type DetailGridProps = {
  className?: string;
  items: DetailGridItem[];
};

export function DetailGrid({ className = "", items }: DetailGridProps) {
  return (
    <dl
      className={`grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2 ${className}`}
    >
      {items.map((item, index) => (
        <div
          className={`min-w-0 bg-white px-4 py-3 ${
            items.length % 2 === 1 && index === items.length - 1 ? "sm:col-span-2" : ""
          }`}
          key={item.label}
        >
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {item.label}
          </dt>
          <dd
            className={`mt-1 min-w-0 text-sm font-semibold text-slate-950 ${
              item.valueClassName ?? ""
            }`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type CompactNoticeProps = ComponentPropsWithoutRef<"div"> & {
  tone?: StatusTone;
};

export function CompactNotice({
  children,
  className = "",
  tone = "neutral",
  ...props
}: CompactNoticeProps) {
  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm ${STATUS_TONE_CLASSES[tone]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

type AdminWorkspaceHeaderProps = {
  description: ReactNode;
  meta?: ReactNode;
  title: string;
};

export function AdminWorkspaceHeader({
  description,
  meta,
  title
}: AdminWorkspaceHeaderProps) {
  return (
    <SectionHeader
      action={meta}
      description={description}
      title={title}
    />
  );
}
