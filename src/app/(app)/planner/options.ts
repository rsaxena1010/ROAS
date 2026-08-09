/** Shared between the planner page and its server actions, so validation can't drift. */

export const PLAN_DIMENSIONS = [
  {
    key: "platform_ad_type",
    label: "Platform × ad type",
    hint: "The usual working grain: Sponsored Products on Amazon is a different channel from a Blinkit banner.",
  },
  { key: "platform", label: "Platform", hint: "Coarse, but every point is measured directly." },
  { key: "ad_type", label: "Ad type", hint: "Across platforms — useful for creative-format decisions." },
  { key: "campaign", label: "Campaign", hint: "Operationally exact, but thin data per curve." },
  { key: "product", label: "SKU", hint: "For catalogue-level bets rather than media buying." },
] as const;

export const PLAN_OBJECTIVES = [
  {
    key: "max_contribution",
    label: "Maximise contribution",
    hint: "Profit after COGS, fees and media. The right default — it will refuse budget that buys revenue at a loss.",
  },
  {
    key: "max_revenue",
    label: "Maximise revenue",
    hint: "Top line at any margin. Use only when chasing share.",
  },
  {
    key: "max_new_customers",
    label: "Maximise new customers",
    hint: "Fits the curves on new-to-brand orders instead of revenue.",
  },
  {
    key: "hit_target_roas",
    label: "Hit target ROAS",
    hint: "Refuses any rupee that returns below the brand's target multiple.",
  },
] as const;

export const MAX_CHANGE_OPTIONS = [
  { value: 0.15, label: "±15% — cautious" },
  { value: 0.35, label: "±35% — default" },
  { value: 0.6, label: "±60% — aggressive" },
  { value: 1, label: "±100% — unconstrained" },
] as const;
