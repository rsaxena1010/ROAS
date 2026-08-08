import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyPoint } from "../types";
import { formatCurrency } from "../format";

export function DailyTrendChart({ data }: { data: DailyPoint[] }) {
  if (data.length === 0) {
    return <div className="empty-state">No synced data in this date range yet.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          stroke="var(--axis)"
          tickFormatter={(d: string) => d.slice(5)}
          minTickGap={24}
        />
        <YAxis
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          stroke="var(--axis)"
          tickFormatter={(v: number) => formatCurrency(v)}
          width={70}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }}
          formatter={(value: number) => formatCurrency(value)}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
        <Line
          type="monotone"
          dataKey="spend"
          name="Ad spend"
          stroke="var(--series-1)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="attributed_sales"
          name="Attributed sales"
          stroke="var(--series-3)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
