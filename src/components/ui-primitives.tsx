import Link from "next/link";
import type {
  ButtonHTMLAttributes,
  ComponentPropsWithoutRef,
  ReactNode
} from "react";

export type StatusTone = "info" | "neutral" | "success" | "warning" | "danger";

const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  danger: "border-red-200 bg-red-50 text-red-700",
  info: "border-cyan-200 bg-cyan-50 text-cyan-800",
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800"
};

type StatusChipProps = {
  children: ReactNode;
  className?: string;
  tone?: StatusTone;
};

export function StatusChip({
  children,
  className = "",
  tone = "neutral"
}: StatusChipProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

type ActionLinkProps = {
  children: ReactNode;
  className?: string;
  href: string;
  variant?: "primary" | "secondary" | "quiet";
};

const ACTION_BASE_CLASSES =
  "inline-flex min-h-10 items-center justify-center rounded-md px-3 py-2 text-sm font-semibold transition";

const ACTION_VARIANT_CLASSES = {
  primary: "bg-slate-900 text-white shadow-sm hover:bg-slate-700",
  quiet: "text-slate-700 hover:bg-slate-100 hover:text-slate-950",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
};

export function actionControlClassName(
  variant: "primary" | "secondary" | "quiet" = "primary",
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
  variant?: "primary" | "secondary" | "quiet";
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
  variant?: "primary" | "secondary" | "quiet";
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
      className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}
      {...props}
    >
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
          <dd className="mt-0.5 truncate text-sm font-semibold text-slate-950">{item.value}</dd>
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

type CompactNoticeProps = {
  children: ReactNode;
  className?: string;
  tone?: StatusTone;
};

export function CompactNotice({
  children,
  className = "",
  tone = "neutral"
}: CompactNoticeProps) {
  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm ${STATUS_TONE_CLASSES[tone]} ${className}`}
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
