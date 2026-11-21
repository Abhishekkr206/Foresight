"""Small conversational data assistant for use when the provider is unavailable."""
import difflib
import re
from datetime import datetime, timedelta
from .assistant_data import event_dict
from .query import get_aci_trend, query_events

DOMAIN = ['threats', 'threat', 'beacon', 'beacons', 'battery', 'zones', 'zone', 'health', 'events', 'event', 'chainsaw', 'coverage', 'active', 'sound']


def normalize(text):
    def correct(match):
        word = match.group(0)
        if len(word) < 5 or word in DOMAIN:
            return word
        return next(iter(difflib.get_close_matches(word, DOMAIN, n=1, cutoff=0.83)), word)
    return re.sub(r'\b[a-z]+\b', correct, text.lower().strip())


def intent(text):
    if re.search(r'\b(start|stop|trigger|delete|change)\b.*\b(simulation|scenario|recordings|events|chainsaw)\b', text): return 'control'
    if any(t in text for t in ['threat', 'danger', 'gunshot', 'chainsaw', 'anything wrong', 'anything bad']): return 'threats'
    if any(t in text for t in ['battery', 'beacon', 'offline', 'online']): return 'beacons'
    if any(t in text for t in ['aci', 'acoustic complexity']): return 'aci'
    if any(t in text for t in ['health', 'soundscape', 'coverage', 'how is the forest', 'overall status']): return 'health'
    if any(t in text for t in ['event', 'detection', 'recording']): return 'events'
    if 'zone' in text: return 'zones'
    return None


def respond(prompt, history, snapshot, db, settings, reason=None):
    text = normalize(prompt)
    previous = [normalize(t['text']) for t in history if t['role'] == 'user']
    followup = bool(re.fullmatch(r'(?:and |but |so )?(?:which|what|where|why|how about|what about).*', text)) and (
        len(text.split()) <= 5 and not any(w in text for w in ['health', 'battery', 'aci', 'events', 'threat']))
    prior = next((p for p in reversed(previous) if intent(p)), '')
    topic = intent(prior) if followup and prior else intent(text)
    scope = text + (' ' + prior if followup and prior else '')
    selection = snapshot['selection']
    zone_match = re.search(r'\bzone[ _]*(\d+)[ _]+(\d+)\b', scope)
    zone_id = f'zone_{int(zone_match[1])}_{int(zone_match[2])}' if zone_match else None
    beacon_match = re.search(r'\bbeacon[ _]*(\d+)\b', scope)
    beacon_id = f'BEACON_{int(beacon_match[1]):02}' if beacon_match else None
    if not beacon_id:
        beacon_id = next((b['beacon_id'] for b in snapshot['beacons'] if b['beacon_id'].lower() in scope), None)
    if any(w in text for w in ['selected', 'this zone', 'that zone']): zone_id = zone_id or selection.get('zone_id')
    if any(w in text for w in ['selected', 'this beacon', 'that beacon']): beacon_id = beacon_id or selection.get('beacon_id')
    summary = snapshot['summary']
    zones = [z for z in snapshot['zones'] if not zone_id or z['zone_id'] == zone_id]
    result = dict(answer='', context={}, highlight_beacon_ids=[], highlight_event_ids=[])
    def answer(message, **extra):
        return {**result, 'answer': message, **extra}
    if zone_id and not zones: return answer(f'I cannot find {zone_id} in the configured map.')
    if beacon_id and not any(b['beacon_id'] == beacon_id for b in snapshot['beacons']):
        return answer(f'I cannot find {beacon_id} among the configured beacons.')
    if re.fullmatch(r'(hi|hello|hey|good morning|good evening|good afternoon)[!. ]*', text):
        return answer('Hi! What would you like to check in the forest?')
    if any(w in text for w in ['which model', 'what model', 'using gemini', 'are you gemini']):
        status = 'local data mode because Gemini is unavailable' if reason else 'local data mode'
        return answer(f'The configured model is {settings.gemini_model}. This reply uses {status}.')
    if topic == 'control':
        return answer('I can inspect monitoring data, but scenario changes must be made in Scenarios.')
    historical = any(w in scope for w in ['today', 'yesterday', 'last hour', 'last 24', 'history', 'historical']) or bool(re.search(r'last \d+', scope))
    if topic == 'threats' and not historical:
        if beacon_id and not any(e['beacon_id'] == beacon_id for e in snapshot['latest_events']):
            return answer(f'No recent audio from {beacon_id}; I cannot currently assess threats there.')
        if beacon_id:
            zones = [{**z, 'threats': [e for e in z['threats'] if e['beacon_id'] == beacon_id]} for z in zones]
        reporting = sum(z['reporting_beacon_count'] > 0 for z in zones)
        affected = [z for z in zones if z['threats']]
        if not reporting: return answer(f"I don't have recent audio to assess threats{f' in {zone_id}' if zone_id else ' right now'}.")
        if not affected:
            message = (f'None of the {reporting} reporting zones currently has a detected active threat.'
                       if followup and not beacon_id and not zone_id else
                       f"No active threats detected{f' in {beacon_id or zone_id}' if beacon_id or zone_id else f' in the {reporting} reporting zones'}.")
            return answer(message,
                context={'type': 'zone_threats', 'affected_zone_count': 0, 'observed_zone_count': reporting})
        rows = [f"{z['zone_id']}: {', '.join(sorted({e['sound_class'] for e in z['threats']}))} ({', '.join(sorted({e['beacon_id'] for e in z['threats']}))})" for z in affected]
        records = [e for z in affected for e in z['threats']]
        return answer('Active threats: ' + '; '.join(rows[:5]) + (f'; and {len(rows)-5} more zones.' if len(rows)>5 else '.'),
            highlight_beacon_ids=list(dict.fromkeys(e['beacon_id'] for e in records)), highlight_event_ids=[e['id'] for e in records],
            selected_zone_id=affected[0]['zone_id'] if len(affected)==1 else None,
            context={'type': 'zone_threats', 'affected_zone_count': len(affected), 'observed_zone_count': reporting})
    if topic == 'health' and not zone_id:
        health = summary['forest_health_score']
        context = {'type': 'forest_summary', **{key: summary[key] for key in ['forest_health_score', 'active_threat_count', 'affected_zone_count', 'observed_zone_count', 'populated_zone_count', 'aci_health_score']}}
        coverage = f"Coverage: {summary['observed_zone_count']} of {summary['populated_zone_count']} populated zones observed; unobserved areas are not assessed."
        if health is None: return answer(f'Forest health unavailable: waiting for recent audio. {coverage}', context=context)
        impact = f"; threats in {summary['affected_zone_count']} of {summary['observed_zone_count']} observed zones" if summary['affected_zone_count'] else '; no active threats detected'
        acoustic = f"; acoustic health: {summary['aci_health_score']}%" if summary['aci_health_score'] < 80 else ''
        return answer(f'Forest health: {health}%{impact}{acoustic}. {coverage}', context=context)
    if topic in ['zones', 'health'] and zone_id:
        zone = zones[0]
        if zone['health_score'] is None: return answer(f'{zone_id} has no recent audio; its health cannot currently be assessed.')
        return answer(f"{zone_id}: health {zone['health_score']}%, {zone['reporting_beacon_count']} of {zone['configured_beacon_count']} beacons reporting, {zone['active_threat_count']} reporting a threat.", selected_zone_id=zone_id)
    if topic == 'beacons':
        candidates = [b for b in snapshot['beacons'] if (not beacon_id or b['beacon_id']==beacon_id) and (not zone_id or b['zone_id']==zone_id)]
        if 'offline' in text: candidates = [b for b in candidates if not b['active']]
        elif 'active' in text or 'online' in text: candidates = [b for b in candidates if b['active']]
        if not candidates: return answer('No configured beacons match that status.')
        lines = [f"{b['beacon_id']}: {'online' if b['active'] else 'offline'}, " + (f"battery {b['battery_percentage']:g}%" if b['battery_percentage'] is not None else 'no heartbeat yet') for b in candidates]
        return answer('; '.join(lines[:5]) + (f'; {len(lines)-5} more.' if len(lines)>5 else '.'), highlight_beacon_ids=[b['beacon_id'] for b in candidates], selected_beacon_id=beacon_id)
    if topic == 'aci':
        beacon_id = beacon_id or selection.get('beacon_id')
        if not beacon_id: return answer("Which beacon's ACI would you like to check?")
        trend = get_aci_trend(db, beacon_id, '24h')
        if not trend: return answer(f'No ACI readings are available for {beacon_id} in the last 24 hours.')
        return answer(f"{beacon_id}'s latest ACI is {trend[-1]['aci_value']:.3f}; {len(trend)} readings in the last 24 hours.", selected_beacon_id=beacon_id, highlight_beacon_ids=[beacon_id])
    if topic == 'events' or (topic == 'threats' and historical):
        now = datetime.fromisoformat(snapshot['observed_at'])
        since, end = now - timedelta(hours=24), now
        if 'today' in scope: since = now.replace(hour=0, minute=0, second=0, microsecond=0)
        if 'yesterday' in scope:
            end = now.replace(hour=0, minute=0, second=0, microsecond=0); since = end - timedelta(days=1)
        match = re.search(r'last (\d+)\s*(minute|hour|day)', scope)
        if match: since = now - timedelta(seconds=min(int(match[1]) * {'minute':60,'hour':3600,'day':86400}[match[2]], 30*86400))
        if 'last hour' in scope: since = now - timedelta(hours=1)
        filters = {}
        match_score = re.search(r'(above|over|below|under)\s+(\d+(?:\.\d+)?)\s*%?', scope)
        if match_score:
            filters['threat_score_min' if match_score[1] in ['above','over'] else 'threat_score_max'] = max(0, min(1, float(match_score[2])/100))
        events = query_events(db, beacon_id=beacon_id, zone_id=zone_id, start_time=since, end_time=end, **filters,
            min_final_score=settings.event_threshold if topic == 'threats' else None,
            sound_class=next((w for w in ['chainsaw','gunshot','rain','wind','bird'] if w in scope), None), limit=100)
        if not events: return answer('No matching events were recorded in that time range.')
        rows = [event_dict(e) for e in events]
        preview = '; '.join(f"{e['sound_class']} at {e['beacon_id']}" for e in rows[:3])
        return answer(f"Latest matches: {preview}.", filters=filters, highlight_beacon_ids=list(dict.fromkeys(e['beacon_id'] for e in rows)), highlight_event_ids=[e['id'] for e in rows], context={'type':'event_history','start_time':since.isoformat(),'end_time':end.isoformat()})
    if topic == 'zones':
        return answer('Do you mean zones with active threats, or the currently selected zone?')
    return answer('Do you want to check current threats, a particular zone, or beacon status?')
