import { Suspense } from "react";
import { RangePicker } from "./RangePicker";
import { comparisonLabel, rangeLabel, type Range } from "@/lib/range";

/**
 * Title block plus the date control, in one row above the content.
 *
 * The range picker sits here and nowhere else: a control that changes every number on the
 * page must not live inside one of the cards it changes.
 */
export function PageHeader({
  title,
  description,
  range,
  preset,
  showRange = true,
  actions,
}: {
  title: string;
  description?: string;
  range?: Range;
  preset?: string;
  showRange?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <p
              className="mt-1 max-w-3xl text-sm leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              {description}
            </p>
          )}
        </div>
        {actions}
      </div>

      {showRange && range && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Suspense fallback={<div className="h-8" />}>
            <RangePicker preset={preset ?? "30d"} from={range.from} to={range.to} />
          </Suspense>
          <p className="tabular text-xs" style={{ color: "var(--text-muted)" }}>
            {rangeLabel(range)} · {comparisonLabel(range)}
          </p>
        </div>
      )}
    </div>
  );
}
