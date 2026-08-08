"""Login with Amazon (LWA) OAuth token refresh.

Both the Advertising API and the Selling Partner API authenticate with a
bearer access token minted from a long-lived refresh token via LWA. See
https://developer.amazon.com/docs/login-with-amazon/authorization-code-grant.html
"""
from __future__ import annotations

import time

import httpx

LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"


class LwaAuthError(RuntimeError):
    pass


class LwaTokenProvider:
    """Fetches and caches an LWA access token, refreshing shortly before expiry."""

    def __init__(
        self,
        client: httpx.Client,
        client_id: str,
        client_secret: str,
        refresh_token: str,
    ) -> None:
        self._client = client
        self._client_id = client_id
        self._client_secret = client_secret
        self._refresh_token = refresh_token
        self._access_token: str | None = None
        self._expires_at: float = 0.0

    def get_token(self) -> str:
        if self._access_token and time.monotonic() < self._expires_at - 30:
            return self._access_token
        self._refresh()
        assert self._access_token is not None
        return self._access_token

    def _refresh(self) -> None:
        response = self._client.post(
            LWA_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": self._refresh_token,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if response.status_code != 200:
            raise LwaAuthError(
                f"LWA token refresh failed ({response.status_code}): {response.text}"
            )
        payload = response.json()
        self._access_token = payload["access_token"]
        self._expires_at = time.monotonic() + float(payload.get("expires_in", 3600))
