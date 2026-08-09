"use client";

import type { ReactNode } from "react";
import { CHROME } from "./theme";

interface Row {
  label: string;
  value: string;
  color?: string;
  emphasis?: boolean;
}

/**
 * Single tooltip surface for every chart. Identity is carried by a colour swatch NEXT TO
 * the label — never by colouring the text itself, which would fail contrast on the lighter
 * series slots.
 */
export function TooltipCard({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: Row[];
  footer?: ReactNode;
}) {
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        background: CHROME.surface,
        border: "1px solid var(--border)",
        minWidth: 168,
      }}
    >
      <div className="mb-1.5 font-medium" style={{ color: CHROME.primary }}>
        {title}
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5" style={{ color: CHROME.secondary }}>
              {row.color && (
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: row.color }}
                />
              )}
              {row.label}
            </span>
            <span
              className="tabular font-medium"
              style={{
                color: row.emphasis ? CHROME.primary : CHROME.secondary,
              }}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
      {footer && (
        <div
          className="mt-1.5 border-t pt-1.5 text-[11px]"
          style={{ color: CHROME.muted, borderColor: "var(--border)" }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
