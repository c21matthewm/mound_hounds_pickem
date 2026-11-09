"""Bounded, authenticated transport to the one authoritative application service."""
from __future__ import annotations
import asyncio
import json
from typing import Any
import httpx
from services.config import Settings

MAX_RESPONSE_BYTES = 262_144

BRIDGE_DEADLINE = 15

class BridgeError(RuntimeError):
    """Sanitized failure: never include response bodies, URLs, or credentials."""

class BridgeClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.transport = transport

    async def call(self, action: str, **payload: Any) -> dict[str, Any]:
        self.settings.require_bridge()
        timeout = httpx.Timeout(12.0, connect=3.0)
        try:
            async with asyncio.timeout(BRIDGE_DEADLINE):
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False, transport=self.transport) as client:
                    async with client.stream("POST", self.settings.bridge_url,
                        headers={"X-Webhook-Secret": self.settings.bridge_secret, "Accept": "application/json"},
                        json={"action": action, **payload}) as response:
                        if response.status_code != 200:
                            raise BridgeError("The results application rejected the operation.")
                        body = bytearray()
                        async for chunk in response.aiter_bytes():
                            body.extend(chunk)
                            if len(body) > MAX_RESPONSE_BYTES:
                                raise BridgeError("The results application response was too large.")
            value = json.loads(body)
            if not isinstance(value, dict):
                raise BridgeError("The results application returned an invalid response.")
            return value
        except (TimeoutError, httpx.HTTPError, ValueError) as error:
            raise BridgeError("The results application could not be reached safely.") from error
