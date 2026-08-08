import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PlatformMetrics } from "../types";
import { formatRoas, platformColorVar } from "../format";

export function PlatformRoasBarChart({ rows }: { rows: PlatformMetrics[] }) {
  const data = [...rows]
    .filter((r) => r.roas !== null)
    .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0));

  if (data.length === 0) {
    return <div className="empty-state">No ROAS data yet — sync a connection first.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="display_name"
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          stroke="var(--axis)"
        />
        <YAxis
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          stroke="var(--axis)"
          tickFormatter={(v: number) => `${v}x`}
          width={40}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }}
          formatter={(value: number) => formatRoas(value)}
        />
        <Bar dataKey="roas" name="ROAS" radius={[4, 4, 0, 0]} maxBarSize={48}>
          {data.map((row) => (
            <Cell key={row.platform_key} fill={platformColorVar(row.platform_key)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
