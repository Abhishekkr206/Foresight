import React, { useEffect, useState } from 'react';
import { CircleMarker, MapContainer, Popup, Rectangle, TileLayer, useMap } from 'react-leaflet';
import { BOUNDS, THREAT_THRESHOLD, zones } from '../config/constants';
import { Map as MapIcon, Satellite } from 'lucide-react';

function MapFocus({ event, relatedBeacons, selectedBeacon, selectedBeaconId }) {
  const map = useMap();
  const relatedKey = relatedBeacons.map((beacon) => `${beacon.beacon_id}:${beacon.latitude}:${beacon.longitude}`).join('|');
  useEffect(() => {
    if (!selectedBeacon) return undefined;
    map.stop();
    map.flyTo([selectedBeacon.latitude, selectedBeacon.longitude], 14, { duration: 0.5, easeLinearity: 0.25 });
    return () => map.stop();
  }, [map, selectedBeaconId, selectedBeacon?.latitude, selectedBeacon?.longitude]);
  useEffect(() => {
    if (selectedBeaconId) return undefined;
    const points = [];
    if (event?.beacon) points.push([event.beacon.latitude, event.beacon.longitude]);
    relatedBeacons.forEach((beacon) => points.push([beacon.latitude, beacon.longitude]));
    if (!points.length) return undefined;
    map.stop();
    if (points.length === 1) map.flyTo(points[0], 11, { duration: 0.55, easeLinearity: 0.25 });
    else map.fitBounds(points, { padding: [40, 40], duration: 0.55, easeLinearity: 0.25 });
    return () => map.stop();
  }, [map, selectedBeaconId, event?.id, event?.event?.id, event?.beacon?.latitude, event?.beacon?.longitude, relatedKey]);
  return null;
}

export default function BeaconMap({ beacons, simulator, selectedZone, setSelectedZone, selectedEvent, relatedBeacons, rippleBeacon, highlightedBeacons, selectedBeaconId, onBeaconSelect }) {
  const stateById = Object.fromEntries(relatedBeacons.map((beacon) => [beacon.beacon_id, beacon]));
  const [mapView, setMapView] = useState('street');
  const selectedBeacon = beacons.find((beacon) => beacon.beacon_id === selectedBeaconId);
  const zoneFor = (beacon) => {
    const latStep = (BOUNDS.max_lat - BOUNDS.min_lat) / 4;
    const lonStep = (BOUNDS.max_lon - BOUNDS.min_lon) / 4;
    const row = Math.min(3, Math.max(0, Math.floor((beacon.latitude - BOUNDS.min_lat) / latStep)));
    const col = Math.min(3, Math.max(0, Math.floor((beacon.longitude - BOUNDS.min_lon) / lonStep)));
    return `zone_${row}_${col}`;
  };
  const selectedEventThreat = selectedEvent?.event?.final_score >= THREAT_THRESHOLD;
  const selectedEventBeacon = selectedEvent?.event ? beacons.find((beacon) => beacon.beacon_id === selectedEvent.event.beacon_id) : null;
  const selectedEventZone = selectedEventBeacon ? zoneFor(selectedEventBeacon) : null;

  return <div className="relative"><div className="selected-chunk-label absolute bottom-3 left-3 z-[1000] flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm"><span className="font-semibold text-slate-500">SELECTED CHUNK</span><span className="font-bold text-moss-500">{selectedZone || 'No chunk selected'}</span></div><MapContainer className="h-[560px] w-full rounded-xl" bounds={[[BOUNDS.min_lat, BOUNDS.min_lon], [BOUNDS.max_lat, BOUNDS.max_lon]]} maxBounds={[[BOUNDS.min_lat - 0.02, BOUNDS.min_lon - 0.02], [BOUNDS.max_lat + 0.02, BOUNDS.max_lon + 0.02]]} scrollWheelZoom>
    <TileLayer attribution={mapView === 'street' ? '&copy; OpenStreetMap contributors' : 'Tiles &copy; Esri'} url={mapView === 'street' ? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'} />
    <div className="map-view-toggle absolute right-2 top-2 z-[1000] flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-md" onClick={(event) => event.stopPropagation()}><button type="button" aria-label="Street map" aria-pressed={mapView === 'street'} title="Street map" onClick={() => setMapView('street')} className={`flex h-8 w-8 items-center justify-center rounded-md ${mapView === 'street' ? 'bg-moss-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><MapIcon size={15} /></button><button type="button" aria-label="Satellite view" aria-pressed={mapView === 'satellite'} title="Satellite view" onClick={() => setMapView('satellite')} className={`flex h-8 w-8 items-center justify-center rounded-md ${mapView === 'satellite' ? 'bg-moss-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Satellite size={15} /></button></div>
    <MapFocus event={selectedEvent} relatedBeacons={relatedBeacons} selectedBeacon={selectedBeacon} selectedBeaconId={selectedBeaconId} />
    {zones.map((zone) => {
      const state = simulator?.zones?.[zone.id];
      const activeThreat = Boolean(state?.threat);
      const selectedThreat = selectedEventThreat && selectedEventZone === zone.id;
      const threat = activeThreat || selectedThreat;
      return <Rectangle key={zone.id} bounds={zone.bounds} pathOptions={{ color: threat ? '#dc2626' : selectedZone === zone.id ? '#588157' : '#A3B18A', weight: threat ? 4 : selectedZone === zone.id ? 3 : 1, fillColor: threat ? '#ef4444' : selectedZone === zone.id ? '#588157' : '#A3B18A', fillOpacity: threat ? 0.34 : selectedZone === zone.id ? 0.25 : 0.07, className: threat ? 'threat-zone-pulse' : '' }} eventHandlers={{ click: () => setSelectedZone(zone.id) }} />;
    })}
    {beacons.map((beacon) => {
      const beaconZone = zoneFor(beacon);
      const scenarioThreat = Boolean(simulator?.zones?.[beaconZone]?.threat);
      const eventThreat = selectedEventThreat && (selectedEvent?.event?.beacon_id === beacon.beacon_id || highlightedBeacons.includes(beacon.beacon_id) || selectedEventZone === beaconZone);
      const threat = scenarioThreat || eventThreat;
      const directSelected = selectedBeaconId === beacon.beacon_id || selectedEvent?.event?.beacon_id === beacon.beacon_id;
      const aiHighlighted = highlightedBeacons.includes(beacon.beacon_id);
      const correlationHighlighted = Boolean(stateById[beacon.beacon_id]);
      const selected = directSelected || aiHighlighted || correlationHighlighted;
      const color = threat ? '#dc2626' : selected ? '#d97706' : '#588157';
      return <React.Fragment key={beacon.beacon_id}>
        {(rippleBeacon === beacon.beacon_id || selected || threat) && <CircleMarker center={[beacon.latitude, beacon.longitude]} radius={directSelected || threat ? 22 : 15} pathOptions={{ color, fillColor: color, fillOpacity: 0, opacity: directSelected || threat ? 0.8 : 0.42, weight: directSelected || threat ? 2 : 1, className: rippleBeacon === beacon.beacon_id || threat ? 'beacon-ripple' : '' }} />}
        <CircleMarker center={[beacon.latitude, beacon.longitude]} radius={beacon.is_real_hardware ? 10 : 8} pathOptions={{ color, fillColor: color, fillOpacity: threat ? 0.95 : 0.78, weight: threat ? 4 : directSelected ? 4 : selected ? 3 : 2, className: threat ? 'beacon-pulse threat-beacon' : '' }} eventHandlers={{ click: () => onBeaconSelect(beacon.beacon_id) }}>
          <Popup><strong>{beacon.beacon_id}</strong><br />{beacon.is_real_hardware ? 'Real hardware' : `Simulated / ${beaconZone}`}{threat && <><br /><strong className="text-red-600">Threat active</strong></>}{directSelected && <><br />Selected beacon</>}{!directSelected && aiHighlighted && <><br />AI matched</>}</Popup>
        </CircleMarker>
      </React.Fragment>;
    })}
  </MapContainer></div>;
}
