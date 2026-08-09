import type { ReactNode } from "react";

/** A titled card. `note` is for the honesty line a chart or table needs under it. */
export function Section({
  title,
  description,
  aside,
  children,
  note,
  padded = true,
}: {
  title?: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
  note?: string;
  padded?: boolean;
}) {
  return (
    <section className="card flex flex-col gap-3 p-4">
      {(title || aside) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
            {description && (
              <p
                className="mt-0.5 max-w-2xl text-xs leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {description}
              </p>
            )}
          </div>
          {aside}
        </div>
      )}
      <div className={padded ? "" : "-mx-4 -mb-4"}>{children}</div>
      {note && (
        <p className="text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
          {note}
        </p>
      )}
    </section>
  );
}

const BANNER_TONES = {
  info: { border: "var(--series-1)", icon: "i" },
  warning: { border: "var(--status-warning)", icon: "!" },
  critical: { border: "var(--status-critical)", icon: "!" },
} as const;

/**
 * A caveat the reader must not miss — mixed attribution windows, an allocation rather than a
 * measurement. Carries an icon and a label, never colour alone.
 */
export function Banner({
  tone = "info",
  title,
  children,
}: {
  tone?: keyof typeof BANNER_TONES;
  title: string;
  children?: ReactNode;
}) {
  const t = BANNER_TONES[tone];
  return (
    <div
      className="flex gap-3 rounded-lg border p-3"
      style={{ borderColor: "var(--border)", borderLeft: `3px solid ${t.border}` }}
      role="note"
    >
      <span
        aria-hidden
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ background: t.border }}
      >
        {t.icon}
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium">{title}</p>
        {children && (
          <div className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

/** Label/value pair for the definition-list blocks in Settings and the drill-downs. */
export function KeyValue({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span className="tabular text-sm font-medium">{value}</span>
      {hint && (
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && (
        <p className="max-w-md text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}
