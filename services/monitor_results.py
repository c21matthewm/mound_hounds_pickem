"""One bounded scheduled invocation. Never start a polling loop inside web workers."""
from __future__ import annotations
import argparse
import asyncio
import json
from typing import Any, Awaitable, Callable
import httpx
from services.bridge import BridgeClient, BridgeError
from services.config import Settings, service_url
from services.indycar_results_fetcher import fetch_official_results, ResultsNotPosted, SourceError
from services.models import Candidate, ResultsPayload

INGESTION_DEADLINE = 20
INVOCATION_BUDGET = 165
SOURCE_POLL_BUDGET = 100
MAINTENANCE_RESERVE = 15

async def post_ingestion(payload: ResultsPayload, settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None) -> dict[str, Any]:
    url = service_url(settings.webhook_url, path="/api/webhooks/race-results")
    try:
        async with asyncio.timeout(INGESTION_DEADLINE):
            async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=3.0),
                follow_redirects=False, trust_env=False, transport=transport) as client:
                async with client.stream("POST", url,
                    headers={"X-Webhook-Secret": settings.webhook_secret}, json=payload.model_dump(mode="json")) as response:
                    if response.status_code != 200:
                        raise BridgeError("The ingestion webhook rejected the result.")
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > 262144:
                            raise BridgeError("The ingestion response exceeded its limit.")
        result = json.loads(body)
        if not isinstance(result, dict) or result.get("status") not in {"staged", "already_processed"}:
            raise BridgeError("The ingestion response was invalid.")
        return result
    except (TimeoutError, httpx.HTTPError, ValueError) as error:
        raise BridgeError("The ingestion webhook could not be reached safely.") from error

async def monitor_once(settings: Settings, bridge: BridgeClient | None = None,
        fetcher: Callable[[Candidate], Awaitable[ResultsPayload]] = fetch_official_results,
        poster: Callable[[ResultsPayload, Settings], Awaitable[dict[str, Any]]] = post_ingestion,
        *, dry_run: bool = False) -> dict[str, Any]:
    summary = {"status": "disabled", "checked": 0, "staged": 0, "already_processed": 0,
        "not_posted": 0, "waiting_official":0, "errors": 0}
    if not settings.monitor_enabled:
        return summary
    settings.require_ingestion()
    service_url(settings.webhook_url, path="/api/webhooks/race-results")
    bridge = bridge or BridgeClient(settings)
    loop = asyncio.get_running_loop()
    invocation_deadline = loop.time() + INVOCATION_BUDGET
    summary["status"] = "dry_run" if dry_run else "completed"
    try:
        async with asyncio.timeout_at(min(loop.time() + SOURCE_POLL_BUDGET, invocation_deadline - MAINTENANCE_RESERVE)):
            result = await bridge.call("candidates",claim=not dry_run)
            candidates = result.get("races", [])
            if not isinstance(candidates, list) or len(candidates) > 10:
                raise BridgeError("The candidate response exceeded its bound.")
            if not candidates:
                summary["status"]="dormant"
                return summary
            for raw_candidate in candidates:
                try:
                    candidate = Candidate.model_validate(raw_candidate)
                except ValueError:
                    summary["errors"] += 1
                    continue
                summary["checked"] += 1
                outcome, error_code = "not_posted", None
                try:
                    payload = await fetcher(candidate)
                    if payload.source_status == "unknown":
                        summary["waiting_official"]+=1
                        outcome="waiting_official"
                    elif payload.source_status=="provisional" and candidate.has_provisional:
                        outcome="waiting_official"
                        summary["waiting_official"]+=1
                    elif not dry_run:
                        staged = await poster(payload, settings)
                        summary[staged["status"]] += 1
                        outcome = "staged"
                except ResultsNotPosted:
                    summary["not_posted"] += 1
                except SourceError as error:
                    summary["errors"] += 1
                    outcome, error_code = "error", error.code
                except (BridgeError, ValueError):
                    summary["errors"] += 1
                    outcome, error_code = "error", "ingestion_error"
                if not dry_run:
                    try:
                        await bridge.call("monitor_result", race_id=candidate.race_id, outcome=outcome, error_code=error_code,poll_token=candidate.poll_token)
                    except BridgeError:
                        summary["errors"] += 1
    except TimeoutError:
        summary["status"] = "partial"
        summary["errors"] += 1
    except BridgeError:
        summary["errors"] += 1
    if not dry_run:
        try:
            await bridge.call("maintenance")
        except BridgeError:
            summary["errors"] += 1
    return summary

def main() -> int:
    parser = argparse.ArgumentParser(description="Check at most ten eligible configured races once.")
    parser.add_argument("--once", action="store_true", help="Run one bounded scheduled invocation.")
    parser.add_argument("--dry-run", action="store_true", help="Read sources without staging results or sending messages.")
    parser.add_argument("--in-process", action="store_true", help="Run the authenticated FastAPI ingestion in this scheduled job; no public Python host required.")
    args = parser.parse_args()
    if not args.once:
        parser.error("Use --once; configure an external scheduler rather than a web-worker loop.")
    try:
        settings = Settings.from_environment()
        async def execute():
            if not args.in_process:
                return await monitor_once(settings, dry_run=args.dry_run)
            from services.app import create_app
            transport = httpx.ASGITransport(app=create_app(settings))
            async def local_post(payload, config):
                return await post_ingestion(payload, config, transport)
            return await monitor_once(settings, poster=local_post, dry_run=args.dry_run)
        summary = asyncio.run(asyncio.wait_for(execute(), timeout=180))
        print(json.dumps(summary, sort_keys=True))
        return 1 if summary["errors"] else 0
    except (TimeoutError, BridgeError, ValueError):
        print(json.dumps({"status": "error", "error_code": "monitor_configuration_or_transport"}))
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
