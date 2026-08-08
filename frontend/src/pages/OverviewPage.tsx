import { useEffect, useState } from "react";
import { api } from "../api/client";
import { DailyTrendChart } from "../components/DailyTrendChart";
import { PlatformRoasBarChart } from "../components/PlatformRoasBarChart";
import { PlatformTable } from "../components/PlatformTable";
import { StatTile } from "../components/StatTile";
import { formatCurrency, formatRoas } from "../format";
import type { MetricsResponse } from "../types";

export function OverviewPage({ brandId, days }: { brandId: number; days: number }) {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getMetrics(brandId, days)
      .then((data) => !cancelled && setMetrics(data))
      .catch((err) => !cancelled && setError(String(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [brandId, days]);

  if (loading) return <div className="loading">Loading metrics…</div>;
  if (error) return <div className="error-banner">{error}</div>;
  if (!metrics) return null;

  const { blended, by_platform, daily } = metrics;

  return (
    <div>
      <div className="stat-grid">
        <StatTile label="Blended spend" value={formatCurrency(blended.spend)} sub={`${days}d window`} />
        <StatTile label="Attributed sales" value={formatCurrency(blended.attributed_sales)} />
        <StatTile label="Blended ROAS" value={formatRoas(blended.roas)} />
        <StatTile
          label="Blended CAC"
          value={formatCurrency(blended.cac)}
          sub={`${blended.new_customers} new customers`}
        />
        <StatTile
          label="TACOS"
          value={blended.tacos !== null ? `${(blended.tacos * 100).toFixed(1)}%` : "—"}
          sub="Spend / total revenue"
        />
      </div>

      <div className="card">
        <h2 className="section-title">Spend vs. attributed sales, daily</h2>
        <DailyTrendChart data={daily} />
      </div>

      <div className="card">
        <h2 className="section-title">ROAS by platform</h2>
        <PlatformRoasBarChart rows={by_platform} />
      </div>

      <div className="card">
        <h2 className="section-title">Platform breakdown</h2>
        <PlatformTable rows={by_platform} />
      </div>
    </div>
  );
}
