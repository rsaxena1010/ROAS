export interface Brand {
  id: number;
  name: string;
  created_at: string;
}

export interface PlatformCatalogEntry {
  platform_key: string;
  display_name: string;
}

export interface Connection {
  id: number;
  brand_id: number;
  platform_key: string;
  display_name: string;
  mode: "mock" | "sandbox" | "live";
  is_active: boolean;
  last_synced_at: string | null;
}

export interface ConnectionStatus {
  connected: boolean;
  mode: string;
  detail: string;
}

export interface SyncResult {
  connection_id: number;
  platform_key: string;
  mode: string;
  campaigns_synced: number;
  ad_metric_rows_synced: number;
  orders_synced: number;
}

export interface PlatformMetrics {
  platform_key: string;
  display_name: string;
  spend: number;
  attributed_sales: number;
  revenue: number;
  orders_count: number;
  new_customers: number;
  roas: number | null;
  acos: number | null;
  cac: number | null;
  tacos: number | null;
}

export interface DailyPoint {
  date: string;
  spend: number;
  attributed_sales: number;
  revenue: number;
  orders_count: number;
}

export interface MetricsResponse {
  start: string;
  end: string;
  blended: PlatformMetrics;
  by_platform: PlatformMetrics[];
  daily: DailyPoint[];
}

export interface PlatformPerformance {
  platform_key: string;
  display_name: string;
  total_spend: number;
  total_sales: number;
  avg_roas: number;
  elasticity: number;
  marginal_roas: number;
  data_points: number;
}

export interface Recommendation {
  from_platform: string;
  from_display_name: string;
  to_platform: string;
  to_display_name: string;
  shift_amount: number;
  from_marginal_roas: number;
  to_marginal_roas: number;
  expected_incremental_daily_sales: number;
  rationale: string;
}

export interface RecommendationsResponse {
  start: string;
  end: string;
  performance: PlatformPerformance[];
  recommendations: Recommendation[];
}
