import { SquaresFour, SlidersHorizontal } from '@phosphor-icons/react';
import { NavLink } from 'react-router-dom';
import { cloneElement, useState } from 'react';
import Sidebar from './Sidebar';

export default function DashboardShell({ children, variant, sidebarHealth = 100, sidebarBeacons = [], sidebarSummary = {}, rightPanel = null, selectedBeaconId = null, onBeaconSelect = () => {}, highlightedBeaconIds = [] }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const isSimulation = variant === 'simulation';
  const showAssistant = !isSimulation && rightPanel;
  const linkClass = 'relative flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs';
  return <div className="min-h-screen bg-slate-50">
    <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} health={sidebarHealth} summary={sidebarSummary} beacons={sidebarBeacons} selectedBeaconId={selectedBeaconId} onBeaconSelect={onBeaconSelect} highlightedBeaconIds={highlightedBeaconIds} />
    <div style={{ '--sidebar-width': sidebarOpen ? '288px' : '76px' }} className={`dashboard-shell min-h-screen ${showAssistant ? (assistantOpen ? 'assistant-open' : 'assistant-closed') : ''}`}>
      <header className="app-topbar flex h-16 items-center justify-end px-5 fixed right-0">
          <nav aria-label="Dashboard views" className="view-switch" data-view={isSimulation ? 'scenarios' : 'monitor'}><NavLink to="/dashboard" className={linkClass}><SquaresFour weight="duotone" size={14} /> Monitor</NavLink><NavLink to="/simulation" className={linkClass}><SlidersHorizontal weight="duotone" size={14} /> Scenarios</NavLink></nav>
      </header>
      {children}
      {showAssistant && cloneElement(rightPanel, { open: assistantOpen, onToggle: () => setAssistantOpen((value) => !value) })}
    </div>
  </div>;
}
