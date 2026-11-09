"""Bounded adapters for the official results page and its published public loader."""
from __future__ import annotations
import asyncio
import math
import json
import hashlib
import sys
import unicodedata
from datetime import datetime
import re
from urllib.parse import parse_qs, urlsplit, urlencode
from bs4 import BeautifulSoup, Tag
import httpx
from services.config import official_url
from services.models import Candidate, ResultRow, ResultsPayload, OfficialEvidence

MAX_SOURCE_BYTES = 1_048_576

SOURCE_DEADLINE = 20
# Negative evidence always wins, including footers and post-inspection notices.
NONFINAL_PATTERN = re.compile(r"\b(?:unofficial|provisional|preliminary|not[\s-]+official|(?:pending|awaiting)[\s-]+(?:review|(?:technical[\s-]+)?inspection))\b", re.I)

class SourceError(RuntimeError):
    code = "source_error"
class ResultsNotPosted(SourceError):
    code = "not_posted"
class SourceLayoutError(SourceError):
    code = "layout_error"
class SourceIdentityError(SourceError):
    code = "identity_mismatch"
class SourceUnavailable(SourceError):
    code = "source_unavailable"

def _key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())

def _number(value: str, *, integer: bool = False) -> int | float | None:
    cleaned = value.strip().replace(",", "")
    if cleaned in {"", "-", "--", "---"}:
        return None
    if integer and not re.fullmatch(r"-?\d+", cleaned):
        return None
    try:
        number = int(cleaned) if integer else float(cleaned)
        return number if math.isfinite(number) and abs(number) <= 10000 else None
    except ValueError:
        return None

HEADERS = {
    "position": {"pos", "position", "finish", "finishingposition"},
    "driver_name": {"driver", "drivername"},
    "car_number": {"no", "number", "carnumber", "car"},
    "laps": {"laps", "lapscompleted"},
    "status": {"status", "reasonout", "runningreasonout"},
    "points": {"points", "pts", "racepoints"},
    "average_speed": {"averagespeed", "avgspeed", "averagespeedmph"},
}

def _identity(soup: BeautifulSoup, table: Tag, candidate: Candidate) -> None:
    """Require source identity from the response, never only the requested query."""
    scope = table.find_parent("section") or soup
    def observed(name: str, attributes: tuple[str, ...], query_names: tuple[str, ...]) -> set[str]:
        values: set[str] = set()
        for attribute in attributes:
            for element in [table, scope, *scope.find_all(attrs={attribute: True})]:
                value = element.get(attribute)
                if isinstance(value, str):
                    values.add(value.strip())
        for meta in soup.find_all("meta"):
            if _key(str(meta.get("name", ""))) == _key(name) or _key(str(meta.get("property", ""))) == _key(name):
                if meta.get("content"):
                    values.add(str(meta["content"]).strip())
        for select in soup.find_all("select"):
            control = _key(str(select.get("name", select.get("id", ""))))
            if control in {_key(value) for value in query_names}:
                for option in select.find_all("option", selected=True):
                    values.add(str(option.get("value", option.get_text(" ", strip=True))).strip())
        # URL parameters can contradict observed identity but cannot prove it.
        query = parse_qs(urlsplit(candidate.source_url).query)
        for key in query_names:
            supplied = {value.strip() for value in query.get(key, [])}
            if supplied and values and supplied != values:
                raise SourceIdentityError("The requested source contradicts its displayed race identity.")
        return values
    years = observed("results-season", ("data-season", "data-year"), ("season", "year"))
    events = observed("results-event-id", ("data-event-id",), ("event_id", "eventId", "event"))
    sessions = observed("results-session-id", ("data-session-id",), ("session_id", "sessionId", "session"))
    if years != {str(candidate.season)} or events != {candidate.event_id} or sessions != {candidate.session_id}:
        raise SourceIdentityError("The official page does not establish the configured race identity.")
    headings = " ".join(node.get_text(" ", strip=True) for node in soup.find_all(["h1", "h2", "h3", "caption"]))
    explicit_table = all(table.get(key) is not None for key in ("data-season", "data-event-id", "data-session-id"))
    if not explicit_table and _key(candidate.race_name) not in _key(headings):
        raise SourceIdentityError("The official page heading does not match the configured race.")

def parse_results_html(html: str, candidate: Candidate) -> ResultsPayload:
    """Return source data only; TypeScript owns mapping and league validation."""
    soup = BeautifulSoup(html, "html.parser")
    eligible: list[tuple[Tag, Tag, dict[str, int]]] = []
    for table in soup.find_all("table"):
        for header in table.find_all("tr"):
            cells = header.find_all(["th", "td"], recursive=False)
            keys = [_key(cell.get_text(" ", strip=True)) for cell in cells]
            matches = {name: [index for index, key in enumerate(keys) if key in names] for name, names in HEADERS.items()}
            if all(matches[name] for name in ("position", "driver_name", "points")):
                if any(len(indices) > 1 for indices in matches.values()):
                    raise SourceLayoutError("The race-results table contains ambiguous column headers.")
                eligible.append((table, header, {name: indices[0] for name, indices in matches.items() if indices}))
                break
    if len(eligible) != 1:
        text = soup.get_text(" ", strip=True).casefold()
        if not eligible and any(marker in text for marker in ("results not yet available", "race has not started", "results will be available after")):
            raise ResultsNotPosted("Official results are not posted yet.")
        raise SourceLayoutError("A single supported race-results table was not available.")
    table, header, columns = eligible[0]
    _identity(soup, table, candidate)
    rows: list[ResultRow] = []
    header_seen = False
    for tr in table.find_all("tr"):
        if tr is header:
            header_seen = True
            continue
        if not header_seen:
            continue
        cells = tr.find_all("td", recursive=False)
        if not cells:
            continue
        values = [cell.get_text(" ", strip=True) for cell in cells]
        if len(values) <= max(columns.values()):
            raise SourceLayoutError("The race-results table changed its column layout.")
        def cell(name: str) -> str:
            return values[columns[name]] if name in columns else ""
        name = cell("driver_name")
        if not name:
            raise SourceLayoutError("A result row has no driver name.")
        rows.append(ResultRow(position=_number(cell("position"), integer=True), driver_name=name,
            car_number=cell("car_number") or None, laps=_number(cell("laps"), integer=True),
            status=cell("status") or None, points=_number(cell("points"), integer=True),
            average_speed=_number(cell("average_speed"))))
        if len(rows) > 100:
            raise SourceLayoutError("The result field exceeds the supported size.")
    if not rows:
        raise SourceLayoutError("The results table is empty or requires an unsupported client-rendered adapter.")
    section = table.find_parent("section") or table
    finality_text = " ".join(node.get_text(" ", strip=True) for node in section.find_all(["h1", "h2", "h3", "caption"]))
    marker = str(table.get("data-results-status", "")).casefold()
    if marker in {"provisional","unofficial","pending"} or NONFINAL_PATTERN.search(soup.get_text(" ", strip=True)):
        finality = "provisional"
    elif marker == "official" or re.search(r"\bofficial\s+(?:final\s+)?(?:race\s+)?results\b", finality_text, re.I):
        finality = "official"
    else:
        finality = "unknown"
    winners = [row for row in rows if row.position == 1]
    speed = winners[0].average_speed if len(winners) == 1 else None
    return ResultsPayload(race_id=candidate.race_id, season=candidate.season, event_id=candidate.event_id,
        session_id=candidate.session_id, source_url=candidate.source_url, source_status=finality,
        race_average_speed=speed, rows=rows,official_evidence=OfficialEvidence(kind="html_header",header="OFFICIAL RESULTS",sha256=hashlib.sha256(html.encode()).hexdigest(),source_url=candidate.source_url) if finality=="official" else None)

def race_page_identity(url: str) -> tuple[int, str, str] | None:
    parsed = urlsplit(official_url(url))
    match = re.fullmatch(r"/results/ntt-indycar-series/(20\d{2}|21\d{2}|2200)/([a-z0-9]+(?:-[a-z0-9]+)*)/(race(?:-?[12])?)/?", parsed.path)
    if not match or parsed.query:
        return None
    return int(match[1]), match[2], match[3]


def _page_metadata(html: str, candidate: Candidate) -> tuple[str, str]:
    identity = race_page_identity(candidate.source_url)
    if identity != (candidate.season, candidate.event_id, candidate.session_id):
        raise SourceIdentityError("The configured identity differs from the official page URL.")
    soup = BeautifulSoup(html, "html.parser")
    def hidden(name: str) -> str:
        nodes = soup.find_all("input", id=name)
        if len(nodes) != 1 or not isinstance(nodes[0].get("value"), str):
            raise SourceLayoutError("The official page no longer exposes its results selector.")
        return str(nodes[0]["value"])
    if (hidden("hdnYear") != str(candidate.season) or hidden("hdnSeriesName") != "ntt-indycar-series"
            or hidden("hdnEvent") != candidate.event_id or hidden("hdnSession") != candidate.session_id):
        raise SourceIdentityError("The official page selectors identify another race.")
    series = hidden("hdnSeries")
    if not re.fullmatch(r"[a-fA-F0-9-]{36}", series):
        raise SourceLayoutError("The official series selector changed format.")
    canonical = soup.find("link", rel="canonical")
    canonical_url = urlsplit(str(canonical.get("href", ""))) if canonical else None
    if (not canonical_url or canonical_url.hostname not in {"www.indycar.com", "indycar.com"}
            or canonical_url.path.rstrip("/") != urlsplit(candidate.source_url).path.rstrip("/")):
        raise SourceIdentityError("The official page canonical identity does not match.")
    # The canonical URL is metadata only; legacy HTTP canonicals are never fetched.
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    match = re.fullmatch(rf"{candidate.season} (.+) - (Race(?: [12])?) Results", title, re.I)
    if not match or _key(match[2]) != _key(candidate.session_id):
        raise SourceIdentityError("The official page title does not identify this race session.")
    return series, match[1]


def _select_session(seasons: object, candidate: Candidate, event_name: str) -> tuple[int, str]:
    if not isinstance(seasons, list) or len(seasons) > 100:
        raise SourceLayoutError("The official season selector changed format.")
    years = [year for year in seasons if isinstance(year, dict) and str(year.get("Year")) == str(candidate.season)]
    if len(years) != 1 or not isinstance(years[0].get("Events"), list):
        raise SourceIdentityError("The official source has no unique configured season.")
    events = [event for event in years[0]["Events"] if isinstance(event, dict) and _key(str(event.get("EventName", ""))) == _key(event_name)]
    if len(events) != 1 or not isinstance(events[0].get("Sessions"), list):
        raise SourceIdentityError("The official source has no unique configured event.")
    sessions = [session for session in events[0]["Sessions"] if isinstance(session, dict)
        and _key(str(session.get("SessionName", ""))) == _key(candidate.session_id)]
    if len(sessions) != 1 or not re.fullmatch(r"[1-9]\d{0,9}", str(sessions[0].get("EventsSessionID", ""))):
        raise SourceIdentityError("The official source has no unique race session.")
    event_id = events[0].get("EventID")
    if not isinstance(event_id, int) or isinstance(event_id, bool) or event_id <= 0:
        raise SourceLayoutError("The official event identifier changed format.")
    return event_id, str(sessions[0]["EventsSessionID"])


def parse_session_payload(data: object, candidate: Candidate, event_name: str, event_id: int, session_id: str) -> ResultsPayload:
    if not isinstance(data, dict):
        raise SourceLayoutError("The official session response changed format.")
    date = str(data.get("SessionDate", ""))
    if (_key(str(data.get("EventName", ""))) != _key(event_name)
            or _key(str(data.get("SessionName", ""))) != _key(candidate.session_id)
            or data.get("SessionType") != "R" or not re.fullmatch(rf"\d{{1,2}}/\d{{1,2}}/{candidate.season}", date)):
        raise SourceIdentityError("The official session response identifies another race.")
    records = data.get("records")
    if records == [] or records is None:
        raise ResultsNotPosted("Official race results are not posted yet.")
    if not isinstance(records, list) or len(records) > 100:
        raise SourceLayoutError("The official results field changed format.")
    rows: list[ResultRow] = []
    for record in records:
        if not isinstance(record, dict) or str(record.get("EventsSessionsID")) != session_id:
            raise SourceIdentityError("A result row belongs to a different session.")
        if record.get("IsDeleted") is not False:
            raise SourceLayoutError("The source contains a deleted or ambiguous result row.")
        name = record.get("DriverName")
        if not isinstance(name, str) or not name.strip():
            raise SourceLayoutError("An official result has no driver name.")
        def numeric(key: str, integer: bool = False) -> int | float | None:
            value = record.get(key)
            if isinstance(value, bool) or value is None:
                return None
            return _number(str(value), integer=integer)
        rows.append(ResultRow(position=numeric("PositionFinish", True), driver_name=name,
            car_number=str(record["CarNumber"]).strip() if record.get("CarNumber") is not None else None,
            laps=numeric("LapsComplete", True), status=record.get("Status") or None,
            points=numeric("PointsEarned", True), average_speed=numeric("SpeedAvg")))
    reports = data.get("SessionReports", [])
    if not isinstance(reports, list) or len(reports) > 100:
        raise SourceLayoutError("The official result reports changed format.")
    active = [report for report in reports if isinstance(report, dict) and report.get("IsActive") is True]
    # Generic Final Reports and an existing PDF are not post-inspection proof.
    labels=" ".join(str(report.get("Name", "")) for report in active if report.get("DocumentType")=="Results")
    finality="provisional" if NONFINAL_PATTERN.search(labels) else "unknown"
    winners = [row for row in rows if row.position == 1]
    return ResultsPayload(race_id=candidate.race_id, season=candidate.season, event_id=candidate.event_id,
        session_id=candidate.session_id, source_url=candidate.source_url, source_status=finality,
        race_average_speed=winners[0].average_speed if len(winners) == 1 else None, rows=rows)


def confirm_pdf_text(text: str, payload: ResultsPayload, event_name: str, session_date: str) -> str:
    """Return only explicit finality when the identity AND every scoring row agree."""
    if len(text)>100_000 or any(len(line)>512 for line in text.splitlines()):return "unknown"
    if NONFINAL_PATTERN.search(text):return "provisional"
    starts=list(re.finditer(r"(?m)^[ \t]*(\d{1,3})[ \t]+\d{1,3}[ \t]+(\d{1,3})[ \t]+([^\r\n]{1,160}?)[ \t]+D/[A-Z]/[A-Z][ \t]+",text))
    if len(starts)>100:return "unknown"
    if not starts:return "unknown"
    header=text[:starts[0].start()]
    if _key(event_name) not in _key(header):return "unknown"
    try:
        date=datetime.strptime(session_date,"%m/%d/%Y")
        date_pattern=rf"{date.strftime('%B')}\s+0?{date.day},?\s+{date.year}"
        if not re.search(date_pattern,header,re.I):return "unknown"
    except ValueError:return "unknown"
    session = re.fullmatch(r"race-?([12])?",payload.session_id,re.I)
    if not session:return "unknown"
    session_pattern="race"+(rf"[ -]?{session[1]}" if session[1] else "")
    if not re.search(r"(?mi)^[ \t]*"+session_pattern+r"[ \t]*$",header):return "unknown"
    if not re.search(r"(?mi)^\s*official\s+(?:final\s+|race\s+)?results\s*$",header):return "unknown"
    if not re.search(r"Pts\s+Total\s+Pts\s+Standings",header,re.I):return "unknown"
    observed=[]
    for index,match in enumerate(starts):
        end=starts[index+1].start() if index+1<len(starts) else text.find("Fastest Lap:",match.end())
        if end<0:return "unknown"
        segment=text[match.end():end]
        points=re.search(r"\s+(\d+)\s+\d+\s+\d+\s*$",segment)
        if not points:return "unknown"
        name=re.sub(r"\s*\(R\)\s*","",match[3]).strip()
        if "," in name:
            last,first=name.split(",",1);name=first+" "+last
        observed.append((int(match[1]),str(int(match[2])),_key(unicodedata.normalize("NFKD",name)),int(points[1])))
    expected=sorted((row.position,str(int(row.car_number or "-1")),_key(unicodedata.normalize("NFKD",row.driver_name)),row.points) for row in payload.rows)
    if sorted(observed)!=expected:return "unknown"
    first_segment=text[starts[0].end():starts[1].start() if len(starts)>1 else text.find("Fastest Lap:")]
    speed=re.search(r"\b\d{2}:\d{2}:\d{2}\.\d+\s+(\d+\.\d+)",first_segment)
    if not speed or payload.race_average_speed is None or abs(float(speed[1])-payload.race_average_speed)>0.001:return "unknown"
    return "official"


async def confirm_pdf(client: httpx.AsyncClient, data: dict, payload: ResultsPayload, event_name: str, event_id: int, session_id: str) -> ResultsPayload:
    if payload.source_status=="provisional":return payload
    path=f"INDYCAR/Documents/{event_id}/{session_id}/indycar-race-results.pdf"
    reports=[report for report in data.get("SessionReports",[]) if isinstance(report,dict) and report.get("IsActive") is True and report.get("DocumentType")=="Results" and report.get("FileType")=="application/pdf" and report.get("Url")==path]
    if len(reports)!=1:return payload
    # INDYCAR's published loader constructs imscdn links. Require verified HTTPS,
    # fixed publisher host/path, no redirects or downgrade to its legacy HTTP link.
    url="https://www.imscdn.com/"+path
    process=None
    try:
        content=await _read_source(client,url,"application/pdf")
        if not content.startswith(b"%PDF-"):return payload
        process=await asyncio.create_subprocess_exec(sys.executable,"-B","-m","services.official_results_pdf",stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
        metadata=json.dumps({"payload":payload.model_dump(mode="json"),"event_name":event_name,"session_date":str(data.get("SessionDate",""))}).encode()
        if len(metadata)>131_072:return payload
        stdout,_=await asyncio.wait_for(process.communicate(metadata+b"\n"+content),timeout=3)
        if process.returncode!=0 or len(stdout)>100:return payload
        finality=json.loads(stdout)["finality"]
        if finality not in {"official","provisional","unknown"}:return payload
        return payload.model_copy(update={"source_status":finality,"official_evidence":OfficialEvidence(kind="pdf_header",header="OFFICIAL RESULTS",sha256=hashlib.sha256(content).hexdigest(),source_url=url) if finality=="official" else None})
    except (SourceError,httpx.HTTPError,TimeoutError,ValueError,TypeError,KeyError):return payload
    finally:
        if process and process.returncode is None:
            process.kill();await process.wait()


async def _read_source(client: httpx.AsyncClient, url: str, kind: str) -> bytes:
    async with client.stream("GET", url, headers={"Accept": kind}) as response:
        if response.status_code in {404, 204}:
            raise ResultsNotPosted("The configured official result is not posted yet.")
        if response.status_code != 200:
            raise SourceUnavailable("The official results source is unavailable.")
        if kind not in response.headers.get("content-type", "").lower():
            raise SourceLayoutError("The official source changed its response format.")
        body = bytearray()
        async for chunk in response.aiter_bytes():
            body.extend(chunk)
            if len(body) > MAX_SOURCE_BYTES:
                raise SourceLayoutError("The official result exceeded the bounded download size.")
    return bytes(body)


async def fetch_official_results(candidate: Candidate, transport: httpx.AsyncBaseTransport | None = None) -> ResultsPayload:
    url = official_url(candidate.source_url)
    try:
        async with asyncio.timeout(SOURCE_DEADLINE):
            async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=3.0), follow_redirects=False,
                trust_env=False, transport=transport,
                headers={"User-Agent": "MoundHoundsResultsMonitor/1.0"}) as client:
                html = (await _read_source(client, url, "text/html")).decode("utf-8-sig", errors="strict")
                if race_page_identity(url) is None:
                    return parse_results_html(html, candidate)
                series, event_name = _page_metadata(html, candidate)
                # These same-origin endpoints are the public loader shipped with
                # the supplied INDYCAR page. No arbitrary URLs from its data run.
                origin = f"https://{urlsplit(url).hostname}"
                seasons = json.loads(await _read_source(client, origin + "/api/results/SeasonDropDown?" + urlencode({"id": series}), "application/json"))
                event_id, session_id = _select_session(seasons, candidate, event_name)
                data = json.loads(await _read_source(client, origin + "/api/results/EventsSessionDetails?" + urlencode({"id": session_id}), "application/json"))
                payload=parse_session_payload(data, candidate, event_name, event_id, session_id)
                return await confirm_pdf(client,data,payload,event_name,event_id,session_id)
    except SourceError:
        raise
    except (TimeoutError, httpx.HTTPError, UnicodeDecodeError, ValueError, TypeError) as error:
        raise SourceUnavailable("The official results source could not be read safely.") from error
