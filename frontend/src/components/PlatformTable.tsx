import type { PlatformMetrics } from "../types";
import { formatCurrency, formatNumber, formatRoas, platformColorVar } from "../format";

export function PlatformTable({ rows }: { rows: PlatformMetrics[] }) {
  if (rows.length === 0) {
    return <div className="empty-state">No platforms connected yet.</div>;
  }
  const sorted = [...rows].sort((a, b) => b.spend - a.spend);
  return (
    <table>
      <thead>
        <tr>
          <th>Platform</th>
          <th>Spend</th>
          <th>Attr. Sales</th>
          <th>ROAS</th>
          <th>ACOS</th>
          <th>CAC</th>
          <th>TACOS</th>
          <th>Orders</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={row.platform_key}>
            <td>
              <span className="platform-chip">
                <span className="dot" style={{ background: platformColorVar(row.platform_key) }} />
                {row.display_name}
              </span>
            </td>
            <td>{formatCurrency(row.spend)}</td>
            <td>{formatCurrency(row.attributed_sales)}</td>
            <td>{formatRoas(row.roas)}</td>
            <td>{row.acos !== null ? `${(row.acos * 100).toFixed(1)}%` : "—"}</td>
            <td>{formatCurrency(row.cac)}</td>
            <td>{row.tacos !== null ? `${(row.tacos * 100).toFixed(1)}%` : "—"}</td>
            <td>{formatNumber(row.orders_count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
