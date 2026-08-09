"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { budgetPlans } from "@/db/schema";
import { requirePrincipal } from "@/lib/auth";
import { loadBrandData } from "@/services/analytics";
import { runPlan, savePlan, type PlanDimension } from "@/services/planner";
import { resolveRange } from "@/lib/range";
import type { Objective } from "@/domain/optimizer";
import { PLAN_DIMENSIONS, PLAN_OBJECTIVES } from "./options";

/**
 * Re-run the plan server-side and persist it. Deliberately does NOT trust a client-supplied
 * allocation: the numbers are recomputed from the same inputs so a saved plan always matches
 * what the optimizer would produce for those parameters.
 */
export async function savePlanAction(formData: FormData): Promise<void> {
  const { brand } = await requirePrincipal();

  const dimension = pick(
    String(formData.get("dimension") ?? ""),
    PLAN_DIMENSIONS.map((d) => d.key),
    "platform_ad_type",
  ) as PlanDimension;
  const objective = pick(
    String(formData.get("objective") ?? ""),
    PLAN_OBJECTIVES.map((o) => o.key),
    "max_contribution",
  ) as Objective;

  const { range } = resolveRange({
    from: str(formData.get("from")),
    to: str(formData.get("to")),
    preset: str(formData.get("preset")),
  });

  const budgetRupees = Number(formData.get("budget"));
  const maxChange = Number(formData.get("maxChange"));

  const data = await loadBrandData(brand, range);
  const output = runPlan(data, {
    dimension,
    objective,
    dailyBudgetPaise:
      Number.isFinite(budgetRupees) && budgetRupees > 0
        ? Math.round(budgetRupees * 100)
        : undefined,
    maxChangeRatio: Number.isFinite(maxChange) && maxChange > 0 ? maxChange : undefined,
  });

  const name = (str(formData.get("name")) || "").trim() ||
    `${PLAN_OBJECTIVES.find((o) => o.key === objective)?.label ?? objective} · ${range.from} to ${range.to}`;

  await savePlan(brand, name, range, output);
  revalidatePath("/planner");
}

export async function deletePlanAction(formData: FormData): Promise<void> {
  const { brand } = await requirePrincipal();
  const id = str(formData.get("planId"));
  if (!id) return;
  // Scope the delete to the caller's brand: the id alone must never be enough.
  await db
    .delete(budgetPlans)
    .where(and(eq(budgetPlans.id, id), eq(budgetPlans.brandId, brand.id)));
  revalidatePath("/planner");
}

function str(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pick(value: string, allowed: readonly string[], fallback: string): string {
  return allowed.includes(value) ? value : fallback;
}
