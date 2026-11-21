from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import assistant
from app.config import Settings
from app.db import Base
from app.models import Beacon, BeaconStatus, Event


@pytest.fixture
def setup(monkeypatch):
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    settings = Settings(_env_file=None, assistant_enabled=False, gemini_api_key=None, aci_baseline=1)
    with sessionmaker(bind=engine)() as db:
        now = datetime.now(timezone.utc)
        db.add_all([Beacon(beacon_id='BEACON_07', latitude=-4.13, longitude=-55.15, is_real_hardware=False),
                    Beacon(beacon_id='BEACON_10', latitude=-4.08, longitude=-54.90, is_real_hardware=False),
                    Beacon(beacon_id='BEACON_01', latitude=-4.00, longitude=-55.05, is_real_hardware=True)])
        db.flush()
        db.add_all([Event(beacon_id=name, timestamp=now, sound_class='Bird', confidence=0.9,
                         threat_score=0, aci_value=0.8, final_score=0, signal_strength=0.9,
                         is_confirmed=False) for name in ['BEACON_07','BEACON_10']])
        db.add(BeaconStatus(beacon_id='BEACON_10', last_seen=now, battery_percentage=73.5))
        db.commit()
        monkeypatch.setattr(assistant, '_provider_states', {})
        yield db, settings
    engine.dispose()


def add_threat(db, age=0):
    event = Event(beacon_id='BEACON_07', timestamp=datetime.now(timezone.utc)-timedelta(seconds=age),
        sound_class='Chainsaw', confidence=0.92, threat_score=0.828, aci_value=0.4,
        final_score=0.75, signal_strength=0.92, is_confirmed=False)
    db.add(event); db.commit()
    return event


@pytest.mark.parametrize('has_threat', [False, True])
def test_original_typo_and_followup_conversation(setup, has_threat):
    db, settings = setup
    record = add_threat(db) if has_threat else None
    greeting = assistant.answer_query('hi', db, settings)
    assert 'Hi!' in greeting.answer
    question = 'is any zone have any thereats'
    first = assistant.answer_query(question, db, settings)
    history = [{'role':'user','text':'hi'}, {'role':'assistant','text':greeting.answer},
               {'role':'user','text':question}, {'role':'assistant','text':first.answer}]
    followup = assistant.answer_query('which zone?', db, settings, history=history)
    if has_threat:
        assert 'zone_0_0' in first.answer and 'zone_0_0' in followup.answer
        assert 'Chainsaw' in followup.answer
        assert 'BEACON_07' in followup.highlight_beacon_ids
        assert record.id in followup.highlight_event_ids
    else:
        assert 'No active threats' in first.answer
        assert 'None of the' in followup.answer
        assert 'reporting zones' in followup.answer
    assert first.mode == 'local_data'
    assert not followup.used_llm
    assert 'Ask about health' not in followup.answer


def test_followup_refreshes_data_instead_of_repeating_old_claims(setup):
    db, settings = setup
    previous = assistant.answer_query('any threats?', db, settings)
    add_threat(db)
    followup = assistant.answer_query('which zone?', db, settings, history=[
        {'role':'user','text':'any threats?'}, {'role':'assistant','text':previous.answer}])
    assert 'zone_0_0' in followup.answer


def test_missing_audio_is_not_reported_as_safe(setup):
    db, settings = setup
    db.query(Event).delete(); db.commit()
    assert 'recent audio' in assistant.answer_query('any threats?', db, settings).answer
    assert 'No active threats' not in assistant.answer_query('any threats?', db, settings).answer


def test_selected_zone_and_all_configured_beacons_are_supported(setup):
    db, settings = setup
    response = assistant.answer_query('how is this zone?', db, settings, selection={'zone_id':'zone_0_0'})
    assert 'zone_0_0' in response.answer
    status = assistant.answer_query('battery for beacon 10?', db, settings)
    assert '73.5%' in status.answer
    assert 'BEACON_10' in status.highlight_beacon_ids
    missing = assistant.answer_query('any threats at BEACON_01?', db, settings)
    assert 'No recent audio' in missing.answer
    unknown = assistant.answer_query('battery for BEACON_99?', db, settings)
    assert 'cannot find BEACON_99' in unknown.answer


def test_historical_events_are_distinct_from_current_threats(setup):
    db, settings = setup
    record = add_threat(db, age=3600)
    current = assistant.answer_query('any threats now?', db, settings)
    assert 'No active threats' in current.answer
    history = assistant.answer_query('show threats in the last 24 hours', db, settings)
    assert 'Chainsaw' in history.answer
    assert record.id in history.highlight_event_ids
    assert history.context['type'] == 'event_history'


def test_ambiguous_followups_clarify_and_controls_remain_read_only(setup):
    db, settings = setup
    assert 'Do you mean' in assistant.answer_query('which zone?', db, settings).answer
    assert 'Scenarios' in assistant.answer_query('trigger chainsaw', db, settings).answer
    assert 'get_zone_status' in assistant.TOOL_NAMES
    with pytest.raises(ValueError): assistant._safe_tool('delete_events', {}, db, settings)
    with pytest.raises(ValueError): assistant._safe_tool('query_events', {'sql':'DELETE FROM events'}, db, settings)


def test_request_history_is_optional_but_bounded():
    assert assistant.AssistantRequest(prompt='hi').history == []
    with pytest.raises(ValidationError): assistant.AssistantRequest(prompt='   ')
    with pytest.raises(ValidationError): assistant.AssistantRequest(prompt='hi', history=[{'role':'system','text':'x'}])
    with pytest.raises(ValidationError): assistant.AssistantRequest(prompt='hi', history=[{'role':'user','text':'x'}]*13)
    with pytest.raises(ValidationError): assistant.AssistantRequest(prompt='hi', history=[{'role':'user','text':'x'*2000}]*7)


class ProviderError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__('sensitive-provider-error-do-not-expose')


@pytest.mark.parametrize('error,reason', [(ProviderError(401),'invalid_credentials'),
    (ProviderError(429),'quota_exceeded'), (ProviderError(404),'unsupported_model'),
    (TimeoutError(),'timeout'), (ValueError('invalid JSON'),'invalid_response'),
    (RuntimeError('network'),'provider_error')])
def test_provider_failures_have_safe_fallback_metadata(setup, monkeypatch, error, reason, caplog):
    db, settings = setup
    settings.assistant_enabled = True; settings.gemini_api_key = 'test-key-do-not-expose'
    def fail(*args): raise error
    monkeypatch.setattr(assistant, '_provider_answer', fail)
    response = assistant.answer_query('any threats?', db, settings)
    assert response.fallback_reason == reason
    assert response.mode == 'local_data'
    assert response.model == 'gemini-3.1-flash-lite'
    assert 'test-key-do-not-expose' not in response.model_dump_json()
    assert 'sensitive-provider-error' not in response.answer
    assert 'sensitive-provider-error' not in caplog.text


def test_authentication_failure_is_cached_and_status_never_calls_provider(setup, monkeypatch):
    db, settings = setup
    settings.assistant_enabled = True; settings.gemini_api_key = 'invalid-test-key'
    calls = []
    def fail(*args):
        calls.append(1); raise ProviderError(401)
    monkeypatch.setattr(assistant, '_provider_answer', fail)
    assistant.answer_query('hi', db, settings)
    assistant.answer_query('any threats?', db, settings)
    status = assistant.assistant_status(settings)
    assert len(calls) == 1
    assert status['fallback_reason'] == 'invalid_credentials'
    assert 'invalid-test-key' not in json.dumps(status)
    assistant._provider_states[assistant._fingerprint(settings)]['at'] -= 61
    assert assistant.assistant_status(settings)['state'] == 'unverified'
    assistant.answer_query('hi', db, settings)
    assert len(calls) == 2


def test_gemini_manual_tool_roles_structured_reply_and_identifier_validation(setup, monkeypatch):
    from google import genai
    from google.genai import types
    db, settings = setup
    settings.assistant_enabled = True; settings.gemini_api_key = 'mock-key'
    record = add_threat(db)
    calls, options, closed = [], [], []
    responses = [SimpleNamespace(candidates=[SimpleNamespace(content=types.Content(role='model', parts=[
        types.Part.from_function_call(name='get_zone_status', args={})]))]),
        SimpleNamespace(candidates=[], text='Found the affected zone.'),
        SimpleNamespace(text=json.dumps({'answer':'Chainsaw activity in zone_0_0.',
            'highlight_beacon_ids':['BEACON_07','INVENTED'], 'highlight_event_ids':[record.id,999999],
            'selected_zone_id':'zone_0_0','selected_beacon_id':'INVENTED'}))]
    class Client:
        def __init__(self, **kwargs):
            options.append(kwargs); self.models = self
        def generate_content(self, **kwargs):
            calls.append(kwargs); return responses.pop(0)
        def close(self): closed.append(True)
    monkeypatch.setattr(genai, 'Client', Client)
    response = assistant.answer_query('which zone?', db, settings,
        history=[{'role':'user','text':'any threats?'},{'role':'assistant','text':'One zone.'}])
    assert response.used_llm and response.mode == 'gemini'
    assert response.highlight_beacon_ids == ['BEACON_07']
    assert response.highlight_event_ids == [record.id]
    assert response.selected_beacon_id is None
    assert response.tool_calls == ['get_zone_status']
    assert len(closed) == len(calls) == 3
    assert calls[-1]['config'].tools is None
    assert calls[-1]['config'].response_mime_type == 'application/json'
    assert all(content.role in ['user','model'] for content in calls[-1]['contents'])
    assert any(any(part.function_response for part in content.parts) and content.role == 'user' for content in calls[-1]['contents'])
    assert 0 < options[0]['http_options'].timeout <= settings.gemini_timeout_seconds*1000
    assert assistant.assistant_status(settings)['state'] == 'connected'


def test_overall_provider_deadline_enforced(setup, monkeypatch):
    from google import genai
    db, settings = setup
    settings.assistant_enabled = True; settings.gemini_api_key = 'mock-key'
    clock = [0]
    monkeypatch.setattr(assistant, 'time', SimpleNamespace(monotonic=lambda: clock[0]))
    class Client:
        def __init__(self, **kwargs): self.models = self
        def close(self): pass
        def generate_content(self, **kwargs):
            clock[0] = 21
            return SimpleNamespace(candidates=[], text='late')
    monkeypatch.setattr(genai, 'Client', Client)
    response = assistant.answer_query('hi', db, settings)
    assert response.fallback_reason == 'timeout'
    assert not response.used_llm
