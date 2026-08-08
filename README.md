# ROAS

A ROAS-, CAC-, and ad-spend-optimization platform for D2C brands selling
across Amazon, Flipkart, Nykaa, Myntra, Instamart, JioMart, BigBasket,
Blinkit, and Zepto.

It pulls ad spend + order data from each marketplace through a pluggable
connector, computes ROAS / ACOS / CAC / TACOS per platform and blended
across all of them, and generates budget-reallocation recommendations from
each platform's estimated marginal ROAS.

No live marketplace credentials are required to run it: every connector
falls back to a deterministic synthetic-data generator when credentials
aren't configured, so the full pipeline — sync, metrics, optimizer,
dashboard — works immediately. The **Amazon** connector is the one built
out for real: full LWA OAuth + Ads API v3 reporting + SP-API orders,
covered by tests against Amazon's documented request/response shapes (see
`docs/AMAZON_INTEGRATION.md` for wiring in real sandbox/live credentials).

## Architecture

```
backend/app/
  connectors/            # one class per marketplace, all implementing
    base.py              #   MarketplaceConnector (fetch_campaigns /
    registry.py          #   fetch_ad_metrics / fetch_orders)
    factory.py            # builds a connector + resolves mock/sandbox/live
    amazon/                # real LWA + Ads API v3 + SP-API implementation
    common/synthetic*.py   # shared deterministic mock-data generator
    platforms/*.py          # Flipkart/Nykaa/Myntra/... (synthetic for now)
  models/                 # SQLAlchemy: Brand, PlatformConnection, Order,
                          # Campaign, AdMetric
  services/
    sync_service.py       # connector -> DB, idempotent per date range
    metrics_service.py    # ROAS / ACOS / CAC / TACOS calculations
    optimizer_service.py  # marginal-ROAS budget reallocation engine
  api/routes/             # FastAPI endpoints
frontend/                 # React + TS dashboard (Overview / Connections /
                          # Recommendations)
```

Everything above the connector layer — sync, metrics, the optimizer, the
API, the dashboard — is marketplace-agnostic. Adding a 10th platform means
writing one new connector class (see "Adding a platform" below); nothing
else changes.

## Metrics

- **ROAS** = attributed ad sales / ad spend
- **ACOS** = ad spend / attributed ad sales (`== 1/ROAS`)
- **TACOS** = ad spend / *total* order revenue — how much of all revenue is
  going to pay for ads, not just the sales ads get credit for
- **CAC** = ad spend / new customers acquired (falls back to spend / total
  orders for platforms — like Amazon's SP-API today — that don't expose
  new-vs-returning status)

## Optimizer

For each platform, `optimizer_service.py` fits `sales = a * spend^b` via a
log-log regression over recent daily (spend, attributed sales) pairs. The
exponent `b` is the channel's elasticity — how much incremental sales the
next rupee of spend still buys. `marginal_roas = b * avg_roas`. Platforms
with high marginal ROAS have room to absorb more budget efficiently;
platforms with low marginal ROAS are over-funded relative to their
efficiency. The engine recommends shifting a bounded fraction of spend from
the weakest platform(s) to the strongest, with the expected incremental
sales shown alongside the reasoning — see the docstring at the top of that
file for the full explanation and its limits.

## Running it

**Backend** (Python 3.11+):
```
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```
This creates `backend/roas.db` (SQLite) on first run. To point it at
Postgres instead, set `DATABASE_URL` (see `.env.example`).

**Frontend**:
```
cd frontend
npm install
npm run dev
```
Open http://localhost:5173 — the dev server proxies `/api` to
`localhost:8000`.

**Try it**: create a brand, go to Connections, click "Connect" on a few
marketplaces (they'll show `MOCK` — no credentials needed), hit "Sync all",
then check Overview and Recommendations.

**Tests**:
```
cd backend && source .venv/bin/activate
python -m pytest app/tests -q
```

## Adding a platform

Most marketplaces here don't have a public self-serve ads API yet, so
they're implemented as tuned synthetic connectors — real numbers, generated
data. To add one:

```python
# app/connectors/platforms/example.py
from app.connectors.common.synthetic_connector import SyntheticConnector
from app.connectors.registry import register

@register
class ExampleConnector(SyntheticConnector):
    platform_key = "example"
    display_name = "Example Mart"
    num_campaigns = 4
    avg_daily_spend = 2500.0
    target_roas = 3.4
    avg_orders_per_day = 25.0
    aov = 550.0
```
Import it from `app/connectors/__init__.py` and it's live everywhere — API,
sync, metrics, dashboard.

To wire up a *real* API instead, subclass `MarketplaceConnector` directly
(see `app/connectors/amazon/connector.py` as the reference implementation)
and implement `test_connection` / `fetch_campaigns` / `fetch_ad_metrics` /
`fetch_orders` against that platform's real endpoints, falling back to the
synthetic generator when no credentials are configured.

## Known limitations

- Synthetic connectors are tuned to be *directionally* realistic (ROAS
  ranges, quick-commerce vs. marketplace order volume/AOV shape) but are
  not real data.
- The optimizer is a heuristic (log-log elasticity + bounded reallocation),
  not a constrained global optimizer — see `optimizer_service.py` docstring.
- Amazon SP-API integration fetches one page of orders per sync call; see
  `docs/AMAZON_INTEGRATION.md` for what a production version would add.
