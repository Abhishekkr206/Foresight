from __future__ import annotations
import json
import logging
from typing import Any
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from .config import Settings
from .models import Event
from .query import answer_local_query, get_aci_trend, get_beacon_status, get_forest_summary, query_events

logger = logging.getLogger(__name__)

class AssistantRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=500)

class AssistantResponse(BaseModel):
    answer: str
    filters: dict[str, Any] = Field(default_factory=dict)
    highlight_beacon_ids: list[str] = Field(default_factory=list)
    highlight_event_ids: list[int] = Field(default_factory=list)
    selected_beacon_id: str | None = None
    selected_event_id: int | None = None
    used_llm: bool = False
    tool_calls: list[str] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)
    @field_validator("highlight_beacon_ids")
    @classmethod
    def unique_beacons(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))[:20]

TOOL_NAMES = {"query_events", "get_beacon_status", "get_aci_trend", "get_forest_summary"}
SYSTEM_INSTRUCTION = """You are Foresight's concise forest acoustic monitoring assistant.
Answer in one short sentence whenever possible, never more than two short sentences.
For Foresight monitoring questions, use only the available read-only tools and never invent data.
For general knowledge, greetings, or casual questions, answer briefly from your general knowledge without calling a tool.
For health or overall-monitoring questions, use get_forest_summary and mention a reason only when an active threat or unusually low ACI makes it necessary.
Do not list every beacon unless explicitly asked. Do not provide SQL or change data.
Always return valid compact JSON with keys: answer, filters, highlight_beacon_ids,
highlight_event_ids, selected_beacon_id, selected_event_id, context.
filters may contain only threat_score_min, threat_score_max, beacon_id, confirmed,
start_time, and end_time. Leave filters, highlights, and context empty when they are not needed."""

def _event_dict(event: Event) -> dict[str, Any]:
    return {"id": event.id, "beacon_id": event.beacon_id, "timestamp": event.timestamp.isoformat() if event.timestamp else None, "sound_class": event.sound_class, "threat_score": event.threat_score, "aci_value": event.aci_value, "final_score": event.final_score, "is_confirmed": event.is_confirmed}

def _safe_tool(name: str, args: dict[str, Any], db: Session, settings: Settings) -> Any:
    if name not in TOOL_NAMES:
        raise ValueError("unsupported assistant tool")
    if name == "query_events":
        allowed = {"threat_score_min", "threat_score_max", "beacon_id", "confirmed", "start_time", "end_time"}
        if set(args) - allowed:
            raise ValueError("unsupported event query argument")
        for key in ("threat_score_min", "threat_score_max"):
            if key in args:
                args[key] = max(0.0, min(1.0, float(args[key])))
        events = query_events(db, **args, limit=100)
        return {"events": [_event_dict(event) for event in events], "count": len(events)}
    if name == "get_forest_summary":
        if args:
            raise ValueError("forest summary does not accept arguments")
        return get_forest_summary(db, settings)
    if name == "get_beacon_status":
        if set(args) - {"beacon_id"}:
            raise ValueError("unsupported status query argument")
        return {"statuses": [{**item, "last_seen": item["last_seen"].isoformat() if item.get("last_seen") else None} for item in get_beacon_status(db, settings, args.get("beacon_id"))]}
    if set(args) - {"beacon_id", "time_range"} or not isinstance(args.get("beacon_id"), str):
        raise ValueError("beacon_id is required for ACI trend")
    return {"trend": [{**item, "timestamp": item["timestamp"].isoformat() if item.get("timestamp") else None} for item in get_aci_trend(db, args["beacon_id"], args.get("time_range", "24h"))]}

def _fallback(prompt: str, db: Session, settings: Settings) -> AssistantResponse:
    normalized = prompt.lower().strip()
    if normalized in {'hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'}:
        return AssistantResponse(answer='Hi. Ask about health, beacons, ACI, or events.')

    health_terms = ('health', 'how is the forest', 'how is the soundscape', 'overall status', 'is everything okay', 'anything bad', 'anything wrong', 'bad happening', 'what is happening', 'happening now', 'right now')
    if any(term in normalized for term in health_terms):
        summary = get_forest_summary(db, settings)
        health = summary['forest_health_score']
        context: dict[str, Any] = {}
        if summary['active_threat_count']:
            count = summary['active_threat_count']
            answer = f"Forest health: {health}%. {count} active threat{'s' if count != 1 else ''}."
            context = {'type': 'forest_summary', 'active_threat_count': count}
        elif summary['aci_health_score'] < 80:
            answer = f"Forest health: {health}%. ACI health: {summary['aci_health_score']}%."
            context = {'type': 'forest_summary', 'aci_health_score': summary['aci_health_score']}
        else:
            answer = f"Forest health: {health}%."
        return AssistantResponse(answer=answer, context=context)

    event_terms = ('event', 'events', 'threat', 'threats', 'detection', 'detections', 'sound', 'below', 'under', 'above', 'over', 'confirmed')
    beacon_terms = ('beacon', 'active', 'battery', 'online', 'offline', 'status')
    aci_terms = ('aci', 'acoustic complexity', 'soundscape activity')
    if not any(term in normalized for term in (*event_terms, *beacon_terms, *aci_terms)):
        return AssistantResponse(answer='Ask about health, beacons, ACI, or events.')

    result = answer_local_query(prompt, db, settings)
    events = [_event_dict(event) for event in result.get('events', [])]
    return AssistantResponse(answer=result['answer'], filters=result.get('filters', {}), highlight_beacon_ids=list(dict.fromkeys(e['beacon_id'] for e in events)), highlight_event_ids=[e['id'] for e in events])
def _extract_json(text: str) -> dict[str, Any]:
    value = json.loads(text.strip())
    if not isinstance(value, dict):
        raise ValueError("assistant response must be an object")
    return value

def answer_query(prompt: str, db: Session, settings: Settings) -> AssistantResponse:
    if not settings.assistant_enabled or not settings.gemini_api_key:
        return _fallback(prompt, db, settings)
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=settings.gemini_api_key)
        declarations = [
            {"name": "query_events", "description": "Find matching acoustic events.", "parameters": {"type": "OBJECT", "properties": {"threat_score_min": {"type": "NUMBER"}, "threat_score_max": {"type": "NUMBER"}, "beacon_id": {"type": "STRING"}, "confirmed": {"type": "BOOLEAN"}, "start_time": {"type": "STRING"}, "end_time": {"type": "STRING"}}}},
            {"name": "get_forest_summary", "description": "Get the current forest health score and the small set of metrics that explain it.", "parameters": {"type": "OBJECT", "properties": {}}},
            {"name": "get_beacon_status", "description": "Get active state and battery for beacons.", "parameters": {"type": "OBJECT", "properties": {"beacon_id": {"type": "STRING"}}}},
            {"name": "get_aci_trend", "description": "Get ACI history for one beacon.", "parameters": {"type": "OBJECT", "required": ["beacon_id"], "properties": {"beacon_id": {"type": "STRING"}, "time_range": {"type": "STRING"}}}},
        ]
        contents: list[Any] = [prompt]
        calls: list[str] = []
        for _ in range(3):
            response = client.models.generate_content(model=settings.gemini_model, contents=contents, config=types.GenerateContentConfig(system_instruction=SYSTEM_INSTRUCTION, tools=[types.Tool(function_declarations=declarations)], temperature=0.1))
            parts = response.candidates[0].content.parts if response.candidates else []
            function_parts = [part for part in parts if getattr(part, "function_call", None)]
            if not function_parts:
                result = _extract_json(response.text or "{}")
                result["used_llm"] = True
                result["tool_calls"] = calls
                return AssistantResponse.model_validate(result)
            contents.append(response.candidates[0].content)
            responses = []
            for part in function_parts:
                call = part.function_call
                name, args = call.name, dict(call.args or {})
                calls.append(name)
                responses.append(types.Part.from_function_response(name=name, response={"result": _safe_tool(name, args, db, settings)}))
            contents.append(types.Content(role="tool", parts=responses))
        raise RuntimeError("assistant tool-call limit reached")
    except Exception:
        logger.exception("Gemini assistant request failed; using local fallback")
        return _fallback(prompt, db, settings)
