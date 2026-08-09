import { redirect } from "next/navigation";
import { getPrincipal } from "@/lib/auth";
import { loginAction } from "./actions";

export const metadata = { title: "Sign in — ROAS" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getPrincipal()) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">ROAS</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          True ROAS, CAC, promotions and brand-fund spend across every marketplace and
          quick-commerce platform you sell on — and where to move the next rupee.
        </p>
      </div>

      <form action={loginAction} className="card flex flex-col gap-4 p-6">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-medium">
            Work email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="growth@yourbrand.in"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        {error && (
          <p
            className="flex items-start gap-1.5 text-xs"
            style={{ color: "var(--status-critical)" }}
          >
            <span aria-hidden>⚠</span>
            <span>{error}</span>
          </p>
        )}

        <button
          type="submit"
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-white"
          style={{ background: "var(--series-1)" }}
        >
          Sign in
        </button>
      </form>

      <div
        className="mt-6 rounded-lg border p-4 text-xs leading-relaxed"
        style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
      >
        <p className="mb-1.5 font-medium" style={{ color: "var(--text-primary)" }}>
          Demo accounts
        </p>
        <p className="tabular">growth@vanyanaturals.in — 7 platforms, 14 SKUs</p>
        <p className="tabular">marketing@harvestco.in — 4 platforms, 5 SKUs</p>
        <p className="mt-1.5">
          Password <code>demo1234</code>. Both run on synthetic sandbox data; no real
          platform credentials are involved.
        </p>
      </div>
    </main>
  );
}
