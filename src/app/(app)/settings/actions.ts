"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { brands, platformAccounts } from "@/db/schema";
import { requirePrincipal } from "@/lib/auth";
import { syncAccount } from "@/services/ingest";
import { rupeesToPaise } from "@/lib/money";
import { lastNDays, toDay } from "@/lib/date";

/** Brand-level targets. These set every break-even and affordability threshold in the app. */
export async function updateTargetsAction(formData: FormData): Promise<void> {
  const { brand } = await requirePrincipal();

  const targetRoas = clamp(Number(formData.get("targetRoas")), 0.5, 50, brand.targetRoas);
  const targetCacRupees = clamp(
    Number(formData.get("targetCac")),
    1,
    1_000_000,
    brand.targetCacPaise / 100,
  );
  const marginPercent = clamp(
    Number(formData.get("targetMargin")),
    0,
    95,
    brand.targetContributionMargin * 100,
  );

  await db
    .update(brands)
    .set({
      targetRoas,
      targetCacPaise: rupeesToPaise(targetCacRupees),
      targetContributionMargin: marginPercent / 100,
    })
    .where(eq(brands.id, brand.id));

  revalidatePath("/settings");
  revalidatePath("/");
}

/** Flip an account between the deterministic sandbox and the live vendor API. */
export async function updateAccountModeAction(formData: FormData): Promise<void> {
  const { brand } = await requirePrincipal();
  const accountId = String(formData.get("platformAccountId") ?? "");
  const mode = String(formData.get("mode") ?? "");
  if (!["sandbox", "live", "file"].includes(mode)) return;

  await db
    .update(platformAccounts)
    .set({ mode: mode as "sandbox" | "live" | "file" })
    .where(
      and(eq(platformAccounts.id, accountId), eq(platformAccounts.brandId, brand.id)),
    );

  revalidatePath("/settings");
}

/**
 * Pull a window from the connector now. `syncAccount` records its own sync_runs row and
 * updates the account's status, so there is nothing to report back here.
 */
export async function syncAccountAction(formData: FormData): Promise<void> {
  const { brand } = await requirePrincipal();
  const accountId = String(formData.get("platformAccountId") ?? "");
  const days = clamp(Number(formData.get("days")), 1, 180, 30);

  const account = await db.query.platformAccounts.findFirst({
    where: and(eq(platformAccounts.id, accountId), eq(platformAccounts.brandId, brand.id)),
  });
  if (!account) return;

  await syncAccount(account.id, lastNDays(days, toDay(Date.now())));

  revalidatePath("/settings");
  revalidatePath("/imports");
  revalidatePath("/");
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
