interface Props {
  label: string;
  value: string;
  sub?: string;
}

export function StatTile({ label, value, sub }: Props) {
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
