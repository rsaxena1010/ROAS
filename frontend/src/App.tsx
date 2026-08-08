import { useEffect, useState } from "react";
import { api } from "./api/client";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { RecommendationsPage } from "./pages/RecommendationsPage";
import type { Brand } from "./types";

type Tab = "overview" | "connections" | "recommendations";

const DAY_OPTIONS = [7, 14, 30, 60, 90];

export default function App() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [newBrandName, setNewBrandName] = useState("");
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<Tab>("overview");
  const [syncing, setSyncing] = useState(false);
  const [loadingBrands, setLoadingBrands] = useState(true);

  useEffect(() => {
    api
      .listBrands()
      .then((list) => {
        setBrands(list);
        if (list.length > 0) setBrandId(list[0].id);
      })
      .finally(() => setLoadingBrands(false));
  }, []);

  async function handleCreateBrand() {
    const name = newBrandName.trim();
    if (!name) return;
    const brand = await api.createBrand(name);
    setBrands((prev) => [...prev, brand]);
    setBrandId(brand.id);
    setNewBrandName("");
  }

  async function handleSyncAll() {
    if (!brandId) return;
    setSyncing(true);
    try {
      await api.syncAll(brandId, days);
      setTab("overview");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand-mark">
          RO<span>AS</span>
        </div>
        <div className="controls">
          {brands.length > 0 && (
            <select
              value={brandId ?? ""}
              onChange={(e) => setBrandId(Number(e.target.value))}
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <input
            type="text"
            placeholder="New brand name"
            value={newBrandName}
            onChange={(e) => setNewBrandName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateBrand()}
            style={{ width: 150 }}
          />
          <button className="secondary" onClick={handleCreateBrand}>
            Add brand
          </button>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
          {brandId && (
            <button onClick={handleSyncAll} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync all"}
            </button>
          )}
        </div>
      </div>

      {loadingBrands ? (
        <div className="loading">Loading…</div>
      ) : !brandId ? (
        <div className="card">
          <h2 className="section-title">Create your first brand</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
            Add a brand above to start connecting marketplaces like Amazon, Flipkart, Nykaa, Myntra,
            Instamart, JioMart, BigBasket, Blinkit and Zepto.
          </p>
        </div>
      ) : (
        <>
          <div className="tabs">
            <div className={`tab ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}>
              Overview
            </div>
            <div
              className={`tab ${tab === "connections" ? "active" : ""}`}
              onClick={() => setTab("connections")}
            >
              Connections
            </div>
            <div
              className={`tab ${tab === "recommendations" ? "active" : ""}`}
              onClick={() => setTab("recommendations")}
            >
              Recommendations
            </div>
          </div>

          {tab === "overview" && <OverviewPage brandId={brandId} days={days} />}
          {tab === "connections" && <ConnectionsPage brandId={brandId} days={days} />}
          {tab === "recommendations" && <RecommendationsPage brandId={brandId} days={days} />}
        </>
      )}
    </div>
  );
}
