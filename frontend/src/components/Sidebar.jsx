import { BatteryCharging, CaretLeft, CaretRight, Radio } from '@phosphor-icons/react';
import BeaconAudioPlayer from './BeaconAudioPlayer';

const fallbackBeacons = [
  { beacon_id: 'BEACON_01', is_real_hardware: true },
  { beacon_id: 'BEACON_02', is_real_hardware: false },
  { beacon_id: 'BEACON_03', is_real_hardware: false },
];

export default function Sidebar({ open, onToggle, health, summary = {}, beacons = [], selectedBeaconId = null, onBeaconSelect = () => {}, highlightedBeaconIds = [] }) {
  const nodes = beacons.length ? beacons : fallbackBeacons;
  return <aside className={`dashboard-sidebar fixed inset-y-0 left-0 z-40 flex flex-col border-r transition-all duration-300 ${open ? 'w-72' : 'w-[76px]'}`}>
    <button onClick={onToggle} aria-label={open ? 'Collapse information panel' : 'Expand information panel'} className="sidebar-toggle absolute right-3 top-7 z-100 flex h-7 w-7 items-center justify-center rounded-lg border bg-white text-slate-700 transition hover:bg-slate-100 active:scale-[.98]">
      {open ? <CaretLeft weight="duotone" size={16} strokeWidth={2} /> : <CaretRight weight="duotone" size={16} strokeWidth={2} />}
    </button>
    <div className="sidebar-header relative flex h-20 items-center gap-3 border-b px-4">
      {open && <div className="logo-window logo-window-open"><img src="/logo.png" alt="Foresight" className="logo-wordmark" /></div>}
    </div>
    <div className="sidebar-scroll flex-1 overflow-auto p-4">
      {open ? <>
        <div className="sidebar-health rounded-2xl p-4">
          <p className="text-[10px] font-semibold tracking-[.16em] text-slate-500">FOREST HEALTH</p>
          <p className="mt-1 text-5xl font-semibold tracking-[-.08em] text-slate-900">{Math.round(health)}%</p>
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-600"> Soundscape stable</div>
        </div>
        <div className="sidebar-stats mt-3 grid grid-cols-2 gap-2">
          {[['ACTIVE', summary.active_beacon_count ?? 0], ['THREATS', summary.active_threat_count ?? 0]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-200 px-3 py-2"><p className="text-[9px] font-semibold tracking-wider text-slate-600">{label}</p><p className="mt-1 text-lg font-semibold text-slate-900">{value}</p></div>)}
        </div>
        <div className="mt-6"><div className="flex items-end justify-between"><p className="text-[10px] font-semibold tracking-[.16em] text-slate-500">BEACONS</p><span className="text-xs text-slate-500">{nodes.length} nodes</span></div>
          <div className="mt-3 space-y-2">{nodes.map((beacon) => <div key={beacon.beacon_id} className={`beacon-sidebar-card ${selectedBeaconId === beacon.beacon_id ? 'beacon-sidebar-card-expanded' : ''}`}><button type="button" onClick={() => onBeaconSelect(beacon.beacon_id)} aria-pressed={selectedBeaconId === beacon.beacon_id} aria-expanded={selectedBeaconId === beacon.beacon_id} className={`beacon-sidebar-row flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${beacon.threat_active ? 'beacon-sidebar-row-threat' : selectedBeaconId === beacon.beacon_id ? 'beacon-sidebar-row-selected' : highlightedBeaconIds.includes(beacon.beacon_id) ? 'beacon-sidebar-row-ai' : ''}`}><span className={`h-2 w-2 rounded-full ${beacon.threat_active ? 'bg-amber-700' : beacon.severity === 'warning' ? 'bg-[#D79A3B]' : beacon.active === false ? 'bg-slate-300' : 'bg-moss-500'}`}></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-900">{beacon.beacon_id}</p><p className="mt-1 text-[10px] text-slate-500">{beacon.is_real_hardware ? 'Hardware' : 'Simulated'}</p></div><span className="flex items-center gap-1 text-[10px] text-slate-500">{beacon.battery_percentage !== undefined && <BatteryCharging weight="duotone" size={12} />}{beacon.battery_percentage !== undefined ? `${Math.round(beacon.battery_percentage)}%` : 'Ready'}</span>{selectedBeaconId === beacon.beacon_id }</button>{selectedBeaconId === beacon.beacon_id && <><div className="beacon-selected-telemetry"><span>{beacon.active === false ? 'OFFLINE' : 'ACTIVE'}</span><span>{beacon.battery_percentage !== undefined ? 'BAT ' + Math.round(beacon.battery_percentage) + '%' : 'BAT --'}</span><span>{beacon.severity === 'threat' ? 'THREAT' : beacon.severity === 'warning' ? 'WATCH' : 'NORMAL'}</span></div><div className="pl-2"><BeaconAudioPlayer beaconId={beacon.beacon_id} /></div></>}</div>)}</div>
        </div>
      </> : <div className="sidebar-collapsed-status space-y-5 pt-5 text-center"><Radio weight="duotone" size={16} className="mx-auto text-moss-500" /><span className="block text-[10px] font-semibold text-slate-500">{Math.round(health)}%</span>{nodes.map((beacon) => <span key={beacon.beacon_id} className={`mx-auto block h-2 w-2 rounded-full ${beacon.active === false ? 'bg-slate-300' : 'bg-moss-500'}`} title={beacon.beacon_id}></span>)}</div>}
    </div>Z
  </aside>;
}
