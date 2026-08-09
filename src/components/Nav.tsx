"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/recommendations", label: "Recommendations" },
  { href: "/platforms", label: "Platforms" },
  { href: "/skus", label: "SKUs" },
  { href: "/cuts", label: "Cuts" },
  { href: "/promotions", label: "Promos & funds" },
  { href: "/planner", label: "Planner" },
  { href: "/imports", label: "Upload data" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();
  const params = useSearchParams();
  // Carry the selected window across pages so changing view doesn't reset the date range.
  const query = params.toString();
  const suffix = query ? `?${query}` : "";

  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Sections">
      {LINKS.map((link) => {
        const active =
          link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={`${link.href}${suffix}`}
            aria-current={active ? "page" : undefined}
            className="rounded-lg px-3 py-1.5 text-sm transition-colors"
            style={{
              background: active ? "var(--surface-2)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-secondary)",
              fontWeight: active ? 500 : 400,
            }}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
