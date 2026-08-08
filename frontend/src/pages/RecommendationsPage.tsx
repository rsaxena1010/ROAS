import { useEffect, useState } from "react";
import { api } from "../api/client";
import { formatCurrency, formatRoas, platformColorVar } from "../format";
import type { RecommendationsResponse } from "../types";

export function RecommendationsPage({ brandId, days }: { brandId: number; days: number }) {
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getRecommendations(brandId, days)
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(String(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [brandId, days]);

  if (loading) return <div className="loading">Crunching elasticity curves…</div>;
  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return null;

  return (
    <div>
      <div className="card">
        <h2 className="section-title">Budget reallocation recommendations</h2>
        {data.recommendations.length === 0 ? (
          <div className="empty-state">
            Not enough signal yet to recommend a reallocation — sync at least two platforms with a
            few days of overlapping data.
          </div>
        ) : (
          data.recommendations.map((rec) => (
            <div className="rec-card" key={`${rec.from_platform}-${rec.to_platform}`}>
              <div className="rec-flow">
                <span className="platform-chip">
                  <span className="dot" style={{ background: platformColorVar(rec.from_platform) }} />
                  {rec.from_display_name}
                </span>
                <span className="rec-arrow">shift {formatCurrency(rec.shift_amount)}/day →</span>
                <span className="platform-chip">
                  <span className="dot" style={{ background: platformColorVar(rec.to_platform) }} />
                  {rec.to_display_name}
                </span>
              </div>
              <div className="rec-rationale">{rec.rationale}</div>
              <div style={{ marginTop: 8, fontSize: 13 }}>
                Expected uplift: <span className="rec-amount">+{formatCurrency(rec.expected_incremental_daily_sales)}/day</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2 className="section-title">Platform efficiency (marginal ROAS)</h2>
        <table>
          <thead>
            <tr>
              <th>Platform</th>
              <th>Spend</th>
              <th>Avg ROAS</th>
              <th>Elasticity</th>
              <th>Marginal ROAS</th>
              <th>Data points</th>
            </tr>
          </thead>
          <tbody>
            {[...data.performance]
              .sort((a, b) => b.marginal_roas - a.marginal_roas)
              .map((p) => (
                <tr key={p.platform_key}>
                  <td>
                    <span className="platform-chip">
                      <span className="dot" style={{ background: platformColorVar(p.platform_key) }} />
                      {p.display_name}
                    </span>
                  </td>
                  <td>{formatCurrency(p.total_spend)}</td>
                  <td>{formatRoas(p.avg_roas)}</td>
                  <td>{p.elasticity.toFixed(2)}</td>
                  <td>{formatRoas(p.marginal_roas)}</td>
                  <td>{p.data_points}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {data.performance.length === 0 && (
          <div className="empty-state">No spend data yet — connect and sync a platform first.</div>
        )}
      </div>
    </div>
  );
}
