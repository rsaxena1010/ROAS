"""End-to-end: create a brand, connect marketplaces (mock mode, since no
credentials exist in the test environment), sync data in, and read back
metrics + recommendations through the real HTTP API.
"""


def test_full_brand_lifecycle(client):
    resp = client.post("/api/brands", json={"name": "Glow Co"})
    assert resp.status_code == 200, resp.text
    brand = resp.json()
    brand_id = brand["id"]

    resp = client.get("/api/platforms")
    assert resp.status_code == 200
    platform_keys = {p["platform_key"] for p in resp.json()}
    assert {"amazon", "flipkart", "nykaa", "myntra", "instamart", "jiomart", "bigbasket", "blinkit", "zepto"} <= platform_keys

    for platform_key in ["amazon", "flipkart", "nykaa"]:
        resp = client.post(f"/api/brands/{brand_id}/connections", json={"platform_key": platform_key})
        assert resp.status_code == 200, resp.text
        connection = resp.json()
        assert connection["mode"] == "mock"  # no real credentials in test env

    resp = client.post(f"/api/brands/{brand_id}/connections", json={"platform_key": "amazon"})
    assert resp.status_code == 409  # duplicate

    resp = client.get(f"/api/brands/{brand_id}/connections")
    connections = resp.json()
    assert len(connections) == 3

    amazon_connection_id = next(c["id"] for c in connections if c["platform_key"] == "amazon")
    resp = client.post(f"/api/brands/{brand_id}/connections/{amazon_connection_id}/test")
    assert resp.status_code == 200
    assert resp.json()["connected"] is True

    resp = client.post(f"/api/brands/{brand_id}/sync", params={"days": 21})
    assert resp.status_code == 200, resp.text
    sync_results = resp.json()
    assert len(sync_results) == 3
    assert all(r["ad_metric_rows_synced"] > 0 for r in sync_results)

    resp = client.get(f"/api/brands/{brand_id}/metrics", params={"days": 21})
    assert resp.status_code == 200, resp.text
    metrics = resp.json()
    assert len(metrics["by_platform"]) == 3
    assert metrics["blended"]["spend"] > 0
    assert metrics["blended"]["roas"] > 0
    assert len(metrics["daily"]) == 21

    resp = client.get(f"/api/brands/{brand_id}/recommendations", params={"days": 21})
    assert resp.status_code == 200, resp.text
    rec_payload = resp.json()
    assert len(rec_payload["performance"]) == 3
    # with only 21 days of correlated-but-noisy mock data a recommendation
    # may or may not clear the confidence bar — just assert the endpoint
    # returns a well-formed (possibly empty) list.
    assert isinstance(rec_payload["recommendations"], list)


def test_unknown_brand_returns_404(client):
    resp = client.get("/api/brands/999999")
    assert resp.status_code == 404


def test_unknown_platform_key_rejected(client):
    resp = client.post("/api/brands", json={"name": "Some Brand"})
    brand_id = resp.json()["id"]
    resp = client.post(f"/api/brands/{brand_id}/connections", json={"platform_key": "does-not-exist"})
    assert resp.status_code == 400
