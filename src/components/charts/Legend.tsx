"use client";

import { CHROME } from "./theme";

export interface LegendItem {
  key: string;
  label: string;
  color: string;
}

/**
 * A legend is present whenever there are 2+ series — identity must never rest on colour
 * alone. Clicking toggles a series; the colour of the survivors does not change, because
 * slots are bound to entity keys rather than to position.
 */
export function ChartLegend({
  items,
  hidden,
  onToggle,
}: {
  items: LegendItem[];
  hidden?: Set<string>;
  onToggle?: (key: string) => void;
}) {
  if (items.length < 2) return null;

  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1">
      {items.map((item) => {
        const off = hidden?.has(item.key) ?? false;
        const content = (
          <>
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{
                background: off ? "transparent" : item.color,
                border: `1.5px solid ${item.color}`,
              }}
            />
            <span style={{ color: off ? CHROME.muted : CHROME.secondary }}>
              {item.label}
            </span>
          </>
        );

        return (
          <li key={item.key} className="text-xs">
            {onToggle ? (
              <button
                type="button"
                // Hit target is deliberately larger than the swatch.
                className="-mx-1 flex items-center gap-1.5 rounded px-1 py-0.5 hover:opacity-80"
                aria-pressed={!off}
                onClick={() => onToggle(item.key)}
              >
                {content}
              </button>
            ) : (
              <span className="flex items-center gap-1.5">{content}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
