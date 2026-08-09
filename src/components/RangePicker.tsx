"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PRESETS } from "@/lib/range";

/**
 * Date-range control. Presets first (what people actually use), custom behind them.
 * Lives in one row above the charts, per the interaction rules — never inside a chart card.
 */
export function RangePicker({
  preset,
  from,
  to,
}: {
  preset: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function apply(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value == null) q.delete(key);
      else q.set(key, value);
    }
    router.push(`${pathname}?${q.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="flex overflow-hidden rounded-lg border"
        style={{ borderColor: "var(--border)" }}
        role="group"
        aria-label="Date range preset"
      >
        {[...PRESETS, { key: "mtd", label: "Month to date" } as const].map((p) => {
          const active = preset === p.key;
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={active}
              onClick={() => apply({ preset: p.key, from: null, to: null })}
              className="px-3 py-1.5 text-xs"
              style={{
                background: active ? "var(--surface-2)" : "var(--surface-1)",
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                fontWeight: active ? 500 : 400,
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <label htmlFor="range-from" className="sr-only">
          From
        </label>
        <input
          id="range-from"
          type="date"
          defaultValue={from}
          max={to}
          className="!w-auto !py-1 !text-xs"
          onChange={(e) => e.target.value && apply({ from: e.target.value, to, preset: null })}
        />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          to
        </span>
        <label htmlFor="range-to" className="sr-only">
          To
        </label>
        <input
          id="range-to"
          type="date"
          defaultValue={to}
          min={from}
          className="!w-auto !py-1 !text-xs"
          onChange={(e) => e.target.value && apply({ from, to: e.target.value, preset: null })}
        />
      </div>
    </div>
  );
}
