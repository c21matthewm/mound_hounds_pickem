import asyncio
from dataclasses import replace
import json
from pathlib import Path
import re
import socket
import httpx
import pytest
from fastapi.testclient import TestClient
from services.app import create_app
from services.bridge import BridgeClient, BridgeError
from services.config import Settings, official_url, service_url
from services.indycar_results_fetcher import confirm_pdf_text, fetch_official_results, parse_results_html, SourceIdentityError, SourceLayoutError, SourceUnavailable, ResultsNotPosted
from services.models import Candidate
from services.monitor_results import monitor_once

RUN_ID = '00000000-0000-4000-8000-000000000123'
SOURCE_URL = 'https://www.indycar.com/Results?season=2027&event_id=fixture-event&session_id=fixture-race'
CANDIDATE = dict(race_id=1, race_name='Fixture Grand Prix', season=2027, event_id='fixture-event', session_id='fixture-race', source_url=SOURCE_URL)
HTML = (Path(__file__).parent / 'fixtures/synthetic-official-results.html').read_text()

@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError('Real network is forbidden in results-service tests.')
    monkeypatch.setattr(socket.socket, 'connect', blocked)
    monkeypatch.setattr(socket, 'create_connection', blocked)
    monkeypatch.setattr(socket, 'getaddrinfo', blocked)

@pytest.fixture
def settings():
    return Settings(bridge_url='http://127.0.0.1:3007/api/internal/results-automation',
        bridge_secret='b'*48, webhook_secret='w'*48,
        webhook_url='http://127.0.0.1:8010/api/webhooks/race-results')


@pytest.fixture
def payload():
    return parse_results_html(HTML, Candidate(**CANDIDATE)).model_dump(mode='json')

def run_summary(*, status='READY_TO_PUBLISH', count=0):
    return dict(run_id=RUN_ID, race_id=1, race_name='Fixture Grand Prix', payload_hash='0' * 64,
        status=status, is_clean=count == 0, flags_count=count,
        flags=[dict(code='fixture_flag', message=f'Flag number {index + 1}') for index in range(count)],
        preview_url='https://fixture.invalid/admin?tab=results')

class FakeBridge:
    def __init__(self, handler):
        self.handler, self.calls = handler, []
    async def call(self, action, **payload):
        self.calls.append((action, payload))
        return self.handler(action, payload)


@pytest.mark.parametrize('url', ['http://www.indycar.com/Results', 'https://evil.invalid/Results',
    'https://www.indycar.com@evil.invalid/Results', 'https://www.indycar.com:443/Results',
    'https://www.indycar.com/', 'https://www.indycar.com/Results#fragment'])
def test_official_source_urls_fail_closed(url):
    with pytest.raises(ValueError): official_url(url)

def test_loopback_is_only_http_service_exception():
    assert service_url('http://127.0.0.1:3007/api/internal/results-automation')
    with pytest.raises(ValueError): service_url('http://192.168.1.8:3007/api/internal/results-automation')

@pytest.mark.parametrize('configured,secret,status', [(True, None, 401), (True, 'wrong', 401), (False, 'wrong', 503)])
def test_ingestion_authentication_precedes_bridge(settings, payload, configured, secret, status):
    bridge = FakeBridge(lambda *_: pytest.fail('Unauthorized bridge operation.'))
    cfg = settings if configured else replace(settings, webhook_secret='')
    with TestClient(create_app(cfg, bridge)) as client:
        response = client.post('/api/webhooks/race-results', json=payload, headers={'X-Webhook-Secret': secret} if secret else {})
    assert response.status_code == status and bridge.calls == []

def test_duplicate_ingestion_never_double_notifies_or_leaks_claim(settings, payload):
    seen = False
    def handler(action, body):
        nonlocal seen
        assert action == 'stage' and body['payload'] == payload
        status = 'already_processed' if seen else 'staged'
        seen = True
        return dict(status=status, run={**run_summary(), 'private_detail': 'private-must-not-leak'})
    bridge = FakeBridge(handler)
    with TestClient(create_app(settings, bridge)) as client:
        responses = [client.post('/api/webhooks/race-results', json=payload, headers={'X-Webhook-Secret': settings.webhook_secret}) for _ in range(2)]
    assert [r.json()['status'] for r in responses] == ['staged', 'already_processed']
    assert all(r.status_code == 200 and 'private-must-not-leak' not in r.text for r in responses)
    assert {a for a, _ in bridge.calls} == {'stage'}

def test_race_published_during_ingestion_is_noop(settings, payload):
    with TestClient(create_app(settings, FakeBridge(lambda *_: dict(status='already_processed', run=None)))) as client:
        response = client.post('/api/webhooks/race-results', json=payload, headers={'X-Webhook-Secret': settings.webhook_secret})
    assert response.status_code == 200 and response.json()['status'] == 'already_processed'

@pytest.mark.parametrize('change', [{'publish': True}, {'race_id': True}, {'source_url': 'http://127.0.0.1/private'}, {'rows': []}, {'race_average_speed': float('inf')}])
def test_invalid_ingestion_cannot_publish(settings, payload, change):
    bridge = FakeBridge(lambda *_: pytest.fail('Invalid payload reached bridge.'))
    with TestClient(create_app(settings, bridge)) as client:
        response = client.post('/api/webhooks/race-results', content=json.dumps({**payload, **change}), headers={'X-Webhook-Secret': settings.webhook_secret, 'Content-Type': 'application/json'})
    assert response.status_code == 400 and bridge.calls == []

def test_body_size_is_bounded(settings):
    with TestClient(create_app(settings, FakeBridge(lambda *_: pytest.fail('Oversized request reached bridge.')))) as client:
        response = client.post('/api/webhooks/race-results', content='x' * 131073, headers={'X-Webhook-Secret': settings.webhook_secret, 'Content-Type': 'application/json'})
    assert response.status_code == 413




def test_html_adapter_extracts_actual_race_points_and_winner_speed():
    parsed = parse_results_html(HTML, Candidate(**CANDIDATE))
    assert parsed.source_status == 'official' and parsed.race_average_speed == 150.125
    assert [(r.position, r.driver_name, r.points, r.laps, r.status) for r in parsed.rows] == [(1, 'Alex Palou', 53, 80, 'Running'), (2, "Pato O'Ward", 41, 80, 'Running')]

@pytest.mark.parametrize('change,error', [('identity', SourceIdentityError), ('client_rendered', SourceLayoutError), ('total_points', SourceLayoutError), ('duplicate_points', SourceLayoutError), ('query_only_identity', SourceIdentityError)])
def test_source_identity_and_layout_drift_fail_closed(change, error):
    html = HTML
    if change == 'identity': html = html.replace('data-event-id="fixture-event"', 'data-event-id="another-event"')
    if change == 'client_rendered': html = re.sub(r'<tbody>.*?</tbody>', '<tbody></tbody>', html, flags=re.S)
    if change == 'total_points': html = html.replace('<th>Points</th>', '<th>Total Points</th>')
    if change == 'duplicate_points': html = html.replace('<th>Points</th>', '<th>Points</th><th>Pts</th>')
    if change == 'query_only_identity': html = re.sub(r'data-(season|event-id|session-id)="[^"]*"', '', html)
    with pytest.raises(error): parse_results_html(html, Candidate(**CANDIDATE))

def test_provisional_overrides_official_caption_and_unknown_is_preserved():
    assert parse_results_html(HTML.replace('data-results-status="official"', 'data-results-status="provisional"'), Candidate(**CANDIDATE)).source_status == 'provisional'
    unknown = HTML.replace('data-results-status="official"', '').replace('Official Final Race Results', 'Race Results')
    assert parse_results_html(unknown, Candidate(**CANDIDATE)).source_status == 'unknown'

@pytest.mark.parametrize('status,kind', [(302, SourceUnavailable), (404, ResultsNotPosted), (429, SourceUnavailable)])
def test_source_redirects_and_failures_are_explicit(status, kind):
    seen = []
    def respond(request):
        seen.append(str(request.url)); return httpx.Response(status, headers={'Location': 'https://evil.invalid/private'})
    with pytest.raises(kind): asyncio.run(fetch_official_results(Candidate(**CANDIDATE), httpx.MockTransport(respond)))
    assert seen == [SOURCE_URL]

def test_source_decoded_size_is_bounded():
    with pytest.raises(SourceLayoutError):
        asyncio.run(fetch_official_results(Candidate(**CANDIDATE), httpx.MockTransport(lambda _: httpx.Response(200, headers={'Content-Type': 'text/html'}, content=b'x' * 1048577))))

@pytest.mark.parametrize('response', [httpx.Response(302, headers={'Location': 'https://evil.invalid'}), httpx.Response(500, text='sensitive detail'), httpx.Response(200, text='invalid JSON'), httpx.Response(200, content=b'x' * 262145)])
def test_bridge_errors_are_bounded_and_sanitized(settings, response):
    with pytest.raises(BridgeError) as caught: asyncio.run(BridgeClient(settings, httpx.MockTransport(lambda _: response)).call('candidates'))
    assert 'sensitive' not in str(caught.value) and settings.bridge_secret not in str(caught.value)







@pytest.mark.parametrize('mode', ['official', 'provisional', 'unknown', 'not_posted', 'layout_error', 'dry_run'])
def test_monitor_is_bounded_and_never_publishes(settings, mode):
    settings = replace(settings, monitor_enabled=True)
    reports, posted = [], []
    def handler(action, body):
        if action == 'candidates': return {'races': [CANDIDATE]}
        if action == 'monitor_result': reports.append(body); return {'status': 'recorded'}
        if action == 'maintenance': return {'status': 'complete'}
        pytest.fail('Unexpected monitor action: ' + action)
    async def fetcher(candidate):
        if mode == 'not_posted': raise ResultsNotPosted('fixture')
        if mode == 'layout_error': raise SourceLayoutError('fixture')
        return parse_results_html(HTML, candidate).model_copy(update={'source_status': mode if mode in {'official', 'provisional', 'unknown'} else 'official'})
    async def poster(payload, config):
        posted.append(payload); return {'status': 'staged', 'run': run_summary()}
    bridge = FakeBridge(handler)
    summary = asyncio.run(monitor_once(settings, bridge, fetcher, poster, dry_run=mode == 'dry_run'))
    assert summary['checked'] == 1
    if mode in {'official', 'provisional'}: assert len(posted) == 1 and reports[0]['outcome'] == 'staged'
    elif mode == 'dry_run': assert posted == [] and reports == [] and [a for a, _ in bridge.calls] == ['candidates']
    else:
        assert posted == []
        assert reports[0]['error_code'] == ('layout_error' if mode == 'layout_error' else None)
        if mode=='unknown':assert reports[0]['outcome']=='waiting_official' and summary['errors']==0
    assert all(a != 'publish' for a, _ in bridge.calls)

def test_disabled_monitor_has_no_network(settings):
    assert asyncio.run(monitor_once(settings, FakeBridge(lambda *_: pytest.fail('Disabled monitor accessed service.'))))['status'] == 'disabled'



# Synthetic payloads preserve the observed public loader schema without copying
# real participants or contacting the official service during verification.
PAGE_URL = 'https://www.indycar.com/results/ntt-indycar-series/2027/fixture-grand-prix/race'
PAGE_CANDIDATE = Candidate(race_id=1, race_name='League custom display name', season=2027,
    event_id='fixture-grand-prix', session_id='race', source_url=PAGE_URL)
PAGE_HTML = f'''<html><head><title>2027 Fixture Grand Prix - Race Results</title>
<link rel="canonical" href="{PAGE_URL.replace('https:', 'http:')}" /></head><body>
<input id="hdnYear" value="2027"/><input id="hdnSeriesName" value="ntt-indycar-series"/>
<input id="hdnSeries" value="00000000-0000-4000-8000-000000000001"/>
<input id="hdnEvent" value="fixture-grand-prix"/><input id="hdnSession" value="race"/>
</body></html>'''


def session_fixture():
    return dict(EventName='Fixture Grand Prix', SessionName='Race', SessionDate='9/6/2027', SessionType='R',
        records=[dict(EventsSessionsID=1234, IsDeleted=False, DriverName='Fixture Driver',
            CarNumber='01', PositionFinish=1, PointsEarned=54, LapsComplete=95, Status='Running', SpeedAvg=106.756)],
        SessionReports=[dict(Name='Final Reports', IsActive=True, DocumentType='INDYCAR Officiating'),
            dict(Name='Results', IsActive=True, DocumentType='Results', FileType='application/pdf',
                Url='INDYCAR/Documents/456/1234/indycar-race-results.pdf')])


@pytest.mark.parametrize('change,error', [('', None), ('selector', SourceIdentityError),
    ('ambiguous_event', SourceIdentityError), ('session', SourceIdentityError), ('record_session', SourceIdentityError),
    ('deleted', SourceLayoutError), ('no_points', None), ('no_final_reports', None), ('wrong_report', None),
    ('provisional', None), ('empty', ResultsNotPosted)])
def test_published_json_loader_is_bound_to_exact_event_session_and_report(change, error):
    data = session_fixture()
    html = PAGE_HTML
    event = dict(EventID=456, EventName='Fixture Grand Prix', Sessions=[dict(EventsSessionID='1234', SessionName='Race')])
    seasons = [dict(Year=2027, Events=[event])]
    if change == 'selector': html = html.replace('value="2027"', 'value="2026"')
    if change == 'ambiguous_event': seasons[0]['Events'].append(event.copy())
    if change == 'session': data['SessionType'] = 'Q'
    if change == 'record_session': data['records'][0]['EventsSessionsID'] = 9999
    if change == 'deleted': data['records'][0]['IsDeleted'] = True
    if change == 'no_points': del data['records'][0]['PointsEarned']
    if change == 'no_final_reports': data['SessionReports'] = data['SessionReports'][1:]
    if change == 'wrong_report': data['SessionReports'][1]['Url'] = 'INDYCAR/Documents/456/9999/indycar-race-results.pdf'
    if change == 'provisional': data['SessionReports'].append(dict(Name='Provisional Results', IsActive=True,DocumentType='Results'))
    if change == 'empty': data['records'] = []
    requests = []
    def respond(request):
        requests.append(request)
        assert request.method == 'GET'
        if request.url.host=='www.imscdn.com':return httpx.Response(404)
        assert request.url.host == 'www.indycar.com'
        if request.url.path == '/results/ntt-indycar-series/2027/fixture-grand-prix/race':
            return httpx.Response(200, headers={'Content-Type': 'text/html'}, text=html)
        if request.url.path == '/api/results/SeasonDropDown': return httpx.Response(200, json=seasons)
        assert request.url.path == '/api/results/EventsSessionDetails' and request.url.params['id'] == '1234'
        return httpx.Response(200, json=data)
    operation = fetch_official_results(PAGE_CANDIDATE, httpx.MockTransport(respond))
    if error:
        with pytest.raises(error): asyncio.run(operation)
    else:
        result = asyncio.run(operation)
        assert result.race_average_speed == 106.756 and result.rows[0].car_number == '01'
        assert result.rows[0].points == (None if change == 'no_points' else 54)
        assert result.source_status == ('provisional' if change == 'provisional' else 'unknown' if change in {'no_final_reports','wrong_report'} else 'unknown')
        assert len(requests) == (3 if change in {'wrong_report','provisional'} else 4)


class TrickleStream(httpx.AsyncByteStream):
    def __init__(self): self.closed = False
    async def __aiter__(self):
        while True:
            await asyncio.sleep(0.001)
            yield b' '
    async def aclose(self): self.closed = True


@pytest.mark.parametrize('kind', ['bridge', 'source', 'ingestion'])
def test_total_deadline_stops_trickling_response(settings, payload, monkeypatch, kind):
    import services.bridge as bridge_module
    import services.indycar_results_fetcher as source_module
    import services.monitor_results as monitor_module
    from services.models import ResultsPayload
    stream = TrickleStream()
    transport = httpx.MockTransport(lambda _: httpx.Response(201 if kind == 'provider' else 200,
        headers={'Content-Type': 'text/html'}, stream=stream))
    if kind == 'bridge':
        monkeypatch.setattr(bridge_module, 'BRIDGE_DEADLINE', 0.01)
        operation = BridgeClient(settings, transport).call('candidates'); error = BridgeError
    elif kind == 'source':
        monkeypatch.setattr(source_module, 'SOURCE_DEADLINE', 0.01)
        operation = source_module.fetch_official_results(Candidate(**CANDIDATE), transport); error = SourceUnavailable
    elif kind == 'ingestion':
        monkeypatch.setattr(monitor_module, 'INGESTION_DEADLINE', 0.01)
        operation = monitor_module.post_ingestion(ResultsPayload.model_validate(payload), settings, transport); error = BridgeError
    async def check():
        with pytest.raises(error): await asyncio.wait_for(operation, timeout=0.5)
    asyncio.run(check())
    assert stream.closed




@pytest.mark.parametrize('dry_run',[False,True])
def test_source_batch_budget_preserves_dry_run_and_maintenance(settings,monkeypatch,dry_run):
    import services.monitor_results as module
    monkeypatch.setattr(module,'SOURCE_POLL_BUDGET',0.01)
    settings=replace(settings,monitor_enabled=True)
    def handler(action,body):
        if action=='candidates':return {'races':[CANDIDATE]}
        if action=='maintenance':return {'status':'complete'}
        pytest.fail('Unexpected '+action)
    bridge=FakeBridge(handler)
    async def slow(candidate):await asyncio.Event().wait()
    async def check():return await asyncio.wait_for(monitor_once(settings,bridge,slow,dry_run=dry_run),timeout=0.5)
    result=asyncio.run(check())
    assert result['status']=='partial' and result['errors']==1
    assert [a for a,_ in bridge.calls]==(['candidates'] if dry_run else ['candidates','maintenance'])


def test_healthz_has_no_bridge_side_effects(settings):
    bridge=FakeBridge(lambda *_:pytest.fail('Health called bridge'))
    with TestClient(create_app(settings,bridge)) as client:
        assert client.get('/healthz').json()['configured'] is True


PDF_TEXT="""Fixture Grand Prix
September 6, 2027
Official Final Results
Race
Pos SP Car Driver C/E/T
Pts Total Pts Standings
1 1 01 Driver, Fixture D/C/F 95 0 -- 0 01:00:00.0000 106.756 Running 54 482 1
Fastest Lap:
"""

@pytest.mark.parametrize('change,expected',[('official','official'),('unofficial','provisional'),('provisional','provisional'),('lap_report','unknown'),('wrong_event','unknown'),('wrong_points','unknown'),('wrong_date','unknown')])
def test_official_confirmation_requires_matching_post_race_report(change,expected):
    from services.indycar_results_fetcher import parse_session_payload
    source=session_fixture()
    payload=parse_session_payload(source,PAGE_CANDIDATE,'Fixture Grand Prix',456,'1234')
    text=PDF_TEXT
    if change=='unofficial':text=text.replace('Official Final Results','UNOFFICIAL RESULTS')
    if change=='provisional':text=text.replace('Official Final Results','PROVISIONAL RESULTS')
    if change=='lap_report':text=text.replace('Official Final Results','Official Lap Report')
    if change=='wrong_event':text=text.replace('Fixture Grand Prix','Another Race')
    if change=='wrong_points':text=text.replace('Running 54 482','Running 40 482')
    if change=='wrong_date':text=text.replace('September 6','September 7')
    assert confirm_pdf_text(text,payload,'Fixture Grand Prix','9/6/2027')==expected


def test_unofficial_header_overrides_official_html_marker():
    parsed=parse_results_html(HTML.replace('Official Final Race Results','UNOFFICIAL RESULTS'),Candidate(**CANDIDATE))
    assert parsed.source_status=='provisional' and parsed.official_evidence is None


def test_monitor_with_no_due_calendar_race_never_fetches_source(settings):
    settings=replace(settings,monitor_enabled=True)
    bridge=FakeBridge(lambda action,body:{'races':[]} if action=='candidates' else pytest.fail('Dormant job wrote state'))
    async def fetcher(_):pytest.fail('Dormant job fetched INDYCAR')
    result=asyncio.run(monitor_once(settings,bridge,fetcher))
    assert result['status']=='dormant' and result['checked']==0



def test_repeated_provisional_preview_keeps_waiting_without_using_staging_quota(settings):
    settings=replace(settings,monitor_enabled=True)
    candidate={**CANDIDATE,'has_provisional':True}
    bridge=FakeBridge(lambda action,body:{'races':[candidate]} if action=='candidates' else {'status':'recorded'})
    async def fetcher(c):return parse_results_html(HTML,c).model_copy(update={'source_status':'provisional','official_evidence':None})
    async def poster(*_):pytest.fail('Repeated provisional rows should not consume staging quota')
    result=asyncio.run(monitor_once(settings,bridge,fetcher,poster))
    assert result['staged']==0 and result['checked']==1


@pytest.mark.parametrize('footer,expected',[('', 'official'),('PROVISIONAL RESULTS - pending technical inspection','provisional')])
def test_pdf_verifier_extracts_matching_official_scoring_in_isolated_process(footer,expected):
    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject
    from io import BytesIO
    from services.indycar_results_fetcher import parse_session_payload,confirm_pdf
    writer=PdfWriter();page=writer.add_blank_page(width=612,height=792)
    font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
    page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
    commands=['BT /F1 9 Tf 12 TL 25 740 Td']
    for line in (PDF_TEXT+footer).splitlines():commands.append('('+line.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')+') Tj T*')
    commands.append('ET');stream=DecodedStreamObject();stream.set_data('\n'.join(commands).encode());page[NameObject('/Contents')]=writer._add_object(stream)
    out=BytesIO();writer.write(out)
    data=session_fixture();payload=parse_session_payload(data,PAGE_CANDIDATE,'Fixture Grand Prix',456,'1234')
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _:httpx.Response(200,headers={'Content-Type':'application/pdf'},content=out.getvalue()))) as client:
            return await confirm_pdf(client,data,payload,'Fixture Grand Prix',456,'1234')
    result=asyncio.run(check())
    assert result.source_status==expected
    assert (result.official_evidence is not None)==(expected=='official')


@pytest.mark.parametrize('notice',['PRELIMINARY RESULTS','NOT OFFICIAL RESULTS','Pending technical inspection'])
def test_negative_report_notice_cannot_be_upgraded_by_pdf(notice):
    from services.indycar_results_fetcher import parse_session_payload,confirm_pdf
    data=session_fixture();data['SessionReports'][1]['Name']=notice
    payload=parse_session_payload(data,PAGE_CANDIDATE,'Fixture Grand Prix',456,'1234')
    assert payload.source_status=='provisional'
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _:pytest.fail('Known provisional source should not fetch a contradictory PDF'))) as client:
            return await confirm_pdf(client,data,payload,'Fixture Grand Prix',456,'1234')
    assert asyncio.run(check()).source_status=='provisional'


@pytest.mark.parametrize('session',['race1','race-1','race2','race-2'])
def test_doubleheader_pdf_session_forms_agree(session):
    from services.indycar_results_fetcher import parse_session_payload
    payload=parse_session_payload(session_fixture(),PAGE_CANDIDATE,'Fixture Grand Prix',456,'1234').model_copy(update={'session_id':session})
    text=PDF_TEXT.replace('\nRace\n','\nRace '+session[-1]+'\n')
    assert confirm_pdf_text(text,payload,'Fixture Grand Prix','9/6/2027')=='official'
    assert confirm_pdf_text(text.replace('Race '+session[-1],'Race '+('2' if session[-1]=='1' else '1')),payload,'Fixture Grand Prix','9/6/2027')=='unknown'


def test_pdf_text_work_is_bounded_and_footer_negative_wins():
    from services.indycar_results_fetcher import parse_session_payload
    payload=parse_session_payload(session_fixture(),PAGE_CANDIDATE,'Fixture Grand Prix',456,'1234')
    assert confirm_pdf_text(PDF_TEXT+'\nPRELIMINARY RESULTS',payload,'Fixture Grand Prix','9/6/2027')=='provisional'
    assert confirm_pdf_text(PDF_TEXT+' ' * 99000,payload,'Fixture Grand Prix','9/6/2027')=='unknown'
    assert parse_results_html(HTML+'<footer>Pending technical inspection</footer>',Candidate(**CANDIDATE)).source_status=='provisional'
