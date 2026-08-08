import type {
  Brand,
  Connection,
  ConnectionStatus,
  MetricsResponse,
  PlatformCatalogEntry,
  RecommendationsResponse,
  SyncResult,
} from "../types";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${options?.method ?? "GET"} ${path} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listPlatforms: () => request<PlatformCatalogEntry[]>("/platforms"),
  listBrands: () => request<Brand[]>("/brands"),
  createBrand: (name: string) =>
    request<Brand>("/brands", { method: "POST", body: JSON.stringify({ name }) }),
  listConnections: (brandId: number) => request<Connection[]>(`/brands/${brandId}/connections`),
  createConnection: (brandId: number, platformKey: string) =>
    request<Connection>(`/brands/${brandId}/connections`, {
      method: "POST",
      body: JSON.stringify({ platform_key: platformKey }),
    }),
  testConnection: (brandId: number, connectionId: number) =>
    request<ConnectionStatus>(`/brands/${brandId}/connections/${connectionId}/test`, {
      method: "POST",
    }),
  syncAll: (brandId: number, days: number) =>
    request<SyncResult[]>(`/brands/${brandId}/sync?days=${days}`, { method: "POST" }),
  syncConnection: (brandId: number, connectionId: number, days: number) =>
    request<SyncResult>(`/brands/${brandId}/connections/${connectionId}/sync?days=${days}`, {
      method: "POST",
    }),
  getMetrics: (brandId: number, days: number) =>
    request<MetricsResponse>(`/brands/${brandId}/metrics?days=${days}`),
  getRecommendations: (brandId: number, days: number) =>
    request<RecommendationsResponse>(`/brands/${brandId}/recommendations?days=${days}`),
};
