/**
 * Page-level plumbing shared by every route in `app/(app)`.
 *
 * The layout already redirects unauthenticated visitors, but each page still needs the
 * principal to scope its queries, and Next hands `searchParams` in as a promise of
 * possibly-repeated values. Both chores live here so no page re-implements them.
 */

import { redirect } from "next/navigation";
import { getPrincipal, type Principal } from "./auth";
import { resolveRange, type PresetKey, type Range } from "./range";

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Like `requirePrincipal`, but redirects instead of throwing — correct for a page. */
export async function requirePage(): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  return principal;
}

/** `?a=1&a=2` is a client bug, not a feature. Take the first value. */
export function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function readRange(params: RawSearchParams): {
  range: Range;
  preset: PresetKey;
} {
  return resolveRange({
    from: one(params.from),
    to: one(params.to),
    preset: one(params.preset),
  });
}

/** Preserve the active window when linking between sections. */
export function rangeQuery(params: RawSearchParams): string {
  const q = new URLSearchParams();
  for (const key of ["from", "to", "preset"] as const) {
    const value = one(params[key]);
    if (value) q.set(key, value);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}
