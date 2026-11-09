"""Explicit settings. Nothing reads dotenv files or contacts a provider on import."""
from __future__ import annotations
from dataclasses import dataclass, field
import os
from urllib.parse import urlsplit


def service_url(value: str, *, path: str | None = None) -> str:
    parsed = urlsplit(value)
    local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if (not value or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.scheme != "https" and not (parsed.scheme == "http" and local)
            or path is not None and parsed.path != path):
        raise ValueError("Use an exact HTTPS service URL (HTTP is allowed only on loopback).")
    try:
        parsed.port
    except ValueError as error:
        raise ValueError("Invalid service URL.") from error
    if not parsed.hostname:
        raise ValueError("A service hostname is required.")
    return value


def official_url(value: str) -> str:
    parsed = urlsplit(value)
    if (len(value) > 1800 or parsed.scheme != "https"
            or parsed.hostname not in {"www.indycar.com", "indycar.com"}
            or parsed.username or parsed.password or parsed.port is not None
            or parsed.fragment or parsed.path in {"", "/"}):
        raise ValueError("Use an exact official INDYCAR HTTPS results URL.")
    return value


@dataclass(frozen=True)
class Settings:
    bridge_url: str = ""
    bridge_secret: str = field(default="", repr=False)
    webhook_secret: str = field(default="", repr=False)
    webhook_url: str = ""
    monitor_enabled: bool = False

    @classmethod
    def from_environment(cls) -> "Settings":
        def get(name: str) -> str:
            return os.environ.get(name, "").strip()
        return cls(
            bridge_url=get("RESULTS_BRIDGE_URL"), bridge_secret=get("RESULTS_BRIDGE_SECRET"),
            webhook_secret=get("RACE_RESULTS_WEBHOOK_SECRET"), webhook_url=get("RACE_RESULTS_WEBHOOK_URL"),
            monitor_enabled=get("RESULTS_MONITOR_ENABLED").lower() == "true",
        )

    def require_bridge(self) -> None:
        service_url(self.bridge_url, path="/api/internal/results-automation")
        if len(self.bridge_secret) < 32:
            raise ValueError("A separate RESULTS_BRIDGE_SECRET of at least 32 characters is required.")

    def require_ingestion(self) -> None:
        self.require_bridge()
        if len(self.webhook_secret) < 32:
            raise ValueError("A RACE_RESULTS_WEBHOOK_SECRET of at least 32 characters is required.")
        if self.webhook_secret == self.bridge_secret:
            raise ValueError("Ingestion and bridge secrets must be different.")
