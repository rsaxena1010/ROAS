import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { platformColorVar } from "../format";
import type { Connection, PlatformCatalogEntry } from "../types";

export function ConnectionsPage({ brandId, days }: { brandId: number; days: number }) {
  const [platforms, setPlatforms] = useState<PlatformCatalogEntry[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [platformList, connectionList] = await Promise.all([
      api.listPlatforms(),
      api.listConnections(brandId),
    ]);
    setPlatforms(platformList);
    setConnections(connectionList);
  }, [brandId]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const connectionFor = (platformKey: string) => connections.find((c) => c.platform_key === platformKey);

  async function handleConnect(platformKey: string) {
    setBusyKey(platformKey);
    setStatusMessage(null);
    try {
      await api.createConnection(brandId, platformKey);
      await refresh();
    } catch (err) {
      setStatusMessage(String(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleTest(connection: Connection) {
    setBusyKey(connection.platform_key);
    setStatusMessage(null);
    try {
      const result = await api.testConnection(brandId, connection.id);
      setStatusMessage(`${connection.display_name}: ${result.detail}`);
    } catch (err) {
      setStatusMessage(String(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSync(connection: Connection) {
    setBusyKey(connection.platform_key);
    setStatusMessage(null);
    try {
      const result = await api.syncConnection(brandId, connection.id, days);
      setStatusMessage(
        `${connection.display_name}: synced ${result.ad_metric_rows_synced} ad-metric rows and ${result.orders_synced} orders.`
      );
      await refresh();
    } catch (err) {
      setStatusMessage(String(err));
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) return <div className="loading">Loading connections…</div>;

  return (
    <div>
      {statusMessage && <div className="card" style={{ fontSize: 13 }}>{statusMessage}</div>}
      <div className="card">
        <h2 className="section-title">Marketplace connections</h2>
        <div className="connection-grid">
          {platforms.map((platform) => {
            const connection = connectionFor(platform.platform_key);
            const busy = busyKey === platform.platform_key;
            return (
              <div className="connection-card" key={platform.platform_key}>
                <span className="platform-chip">
                  <span className="dot" style={{ background: platformColorVar(platform.platform_key) }} />
                  <span className="name">{platform.display_name}</span>
                </span>
                {connection ? (
                  <>
                    <span className={`badge ${connection.mode}`}>{connection.mode}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {connection.last_synced_at
                        ? `Last synced ${new Date(connection.last_synced_at).toLocaleString()}`
                        : "Never synced"}
                    </span>
                    <div className="connection-actions">
                      <button className="secondary" disabled={busy} onClick={() => handleTest(connection)}>
                        Test
                      </button>
                      <button disabled={busy} onClick={() => handleSync(connection)}>
                        {busy ? "Syncing…" : "Sync"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="connection-actions">
                    <button disabled={busy} onClick={() => handleConnect(platform.platform_key)}>
                      {busy ? "Connecting…" : "Connect"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
