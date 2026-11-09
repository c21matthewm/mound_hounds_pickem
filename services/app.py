"""Authenticated staging-only ingestion. Publication stays in the Admin app."""
from __future__ import annotations
import asyncio
import hashlib
import hmac
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from services.bridge import BridgeClient, BridgeError
from services.config import Settings
from services.models import ResultsPayload

BODY_LIMIT = 131072
def _same_secret(candidate: str, expected: str) -> bool:
    return hmac.compare_digest(hashlib.sha256(candidate.encode()).digest(), hashlib.sha256(expected.encode()).digest())

async def bounded_body(request: Request, limit: int = BODY_LIMIT) -> bytes:
    length = request.headers.get("content-length")
    if length is not None and (not length.isdigit() or int(length) > limit):
        raise HTTPException(413, "Request body exceeds the limit.")
    body = bytearray()
    try:
        async with asyncio.timeout(10):
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > limit:
                    raise HTTPException(413, "Request body exceeds the limit.")
    except TimeoutError as error:
        raise HTTPException(408, "Request body timed out.") from error
    return bytes(body)

def create_app(settings: Settings | None = None, bridge: BridgeClient | None = None) -> FastAPI:
    settings = settings or Settings.from_environment()
    bridge = bridge or BridgeClient(settings)
    app = FastAPI(title="Mound Hounds results ingestion", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.bridge = bridge

    @app.get("/healthz")
    async def health():
        try:
            settings.require_ingestion()
            configured = True
        except ValueError:
            configured = False
        return {"service": "results-ingestion", "configured": configured}

    @app.post("/api/webhooks/race-results")
    async def ingest(request: Request):
        try:
            settings.require_ingestion()
        except ValueError as error:
            raise HTTPException(503, "Results ingestion is not configured.") from error
        supplied = request.headers.get("x-webhook-secret", "")
        if not supplied or not _same_secret(supplied, settings.webhook_secret):
            raise HTTPException(401, "Unauthorized.")
        if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise HTTPException(415, "Use application/json.")
        try:
            payload = ResultsPayload.model_validate_json(await bounded_body(request))
        except (ValidationError, ValueError) as error:
            raise HTTPException(400, "Invalid race results payload.") from error
        try:
            result = await bridge.call("stage", payload=payload.model_dump(mode="json"))
        except BridgeError as error:
            raise HTTPException(502, "The results application could not stage the payload.") from error
        status = result.get("status")
        run = result.get("run")
        if isinstance(status,str) and status == "already_processed" and run is None:
            return JSONResponse({"status": status, "run_id": None, "staging_status": None, "is_clean": False, "flags_count": 0, "already_processed": True, "already_published": True}, headers={"Cache-Control": "no-store"})
        if not isinstance(status,str) or status not in {"staged", "already_processed"} or not isinstance(run, dict):
            raise HTTPException(502, "The results application returned an invalid staging response.")
        count = run.get("flags_count")
        if not isinstance(count, int) or isinstance(count, bool) or not 0 <= count <= 1024:
            raise HTTPException(502, "The staging summary was invalid.")
        return JSONResponse({"status": status, "run_id": run.get("run_id"), "staging_status": run.get("status"),
            "is_clean": run.get("is_clean") is True, "flags_count": count,
            "notice": "OFFICIAL_STAGED" if run.get("source_status",payload.source_status)=="official" else "PROVISIONAL_STAGED",
            "already_processed": status == "already_processed", "already_published": result.get("already_published", run.get("status") == "PUBLISHED")},
            headers={"Cache-Control": "no-store"})

    return app

app = create_app()
