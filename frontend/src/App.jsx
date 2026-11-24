import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useMatch } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import SimulationPage from './pages/SimulationPage';
import DashboardShell from './components/DashboardShell';
import { LiveAudioProvider } from './hooks/useLiveAudio';
import AssistantPanel from './components/AssistantPanel';
import useDashboardData, { DashboardDataProvider } from './hooks/useDashboardData';
import AuthGate from './components/AuthGate';
import AudioDiagnosticsPage from './pages/AudioDiagnosticsPage';

function DashboardRoutes() {
  return <DashboardDataProvider><LiveAudioProvider><Layout /></LiveAudioProvider></DashboardDataProvider>;
}

function Layout() {
  const data = useDashboardData();
  const simulation = Boolean(useMatch('/simulation'));
  const [visited, setVisited] = useState({ dashboard: !simulation, simulation });
  useEffect(() => {
    setVisited((current) => ({ ...current, [simulation ? 'simulation' : 'dashboard']: true }));
  }, [simulation]);
  const toggleBeacon = (id) => data.setSelectedBeaconId((current) => current === id ? null : id);
  const rightPanel = simulation ? null : <AssistantPanel messages={data.assistantMessages} prompt={data.assistantPrompt}
    onPromptChange={data.setAssistantPrompt} onSubmit={data.askAssistant} busy={data.assistantBusy} status={data.assistantStatus} onNewChat={data.newChat}
    highlighted={data.highlightedBeacons.length > 0 || data.highlightedEvents.length > 0}
    highlightedBeacons={data.highlightedBeacons} highlightedEvents={data.highlightedEvents}
    onBeaconSelect={toggleBeacon} onClear={() => { data.setHighlightedBeacons([]); data.setHighlightedEvents([]); data.setSelectedBeaconId(null); }} />;
  const visibleErrors = Object.entries(data.resourceErrors).filter(([name, message]) => message && (!simulation || !['events', 'aci'].includes(name)));
  return <DashboardShell variant={simulation ? 'simulation' : 'dashboard'} sidebarHealth={data.loaded.summary ? data.summary.forest_health_score : null}
    sidebarSummary={{ ...data.summary, loading: !data.loaded.summary }} sidebarBeacons={data.sidebarBeacons} selectedBeaconId={data.selectedBeaconId}
    onBeaconSelect={toggleBeacon} highlightedBeaconIds={data.highlightedBeacons} rightPanel={rightPanel}>
    {visibleErrors.length > 0 && <div className="pt-20">{visibleErrors.map(([name, message]) =>
      <div key={name} role="alert" className="mx-5 mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">{name}: {message} <button onClick={() => data.refresh(name)} className="ml-3 underline">Retry</button></div>)}</div>}
    {(visited.dashboard || !simulation) && <div hidden={simulation}><DashboardPage active={!simulation} /></div>}
    {(visited.simulation || simulation) && <div hidden={!simulation}><SimulationPage active={simulation} /></div>}
    <Outlet />
  </DashboardShell>;
}

export default function App() {
  return <BrowserRouter><Routes><Route element={<AuthGate />}>
    <Route path="/login" element={null} />
    <Route path="/debug/audio/live" element={<AudioDiagnosticsPage />} />
    <Route element={<DashboardRoutes />}>
      <Route path="/dashboard" element={null} />
      <Route path="/simulation" element={null} />
    </Route>
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Route></Routes></BrowserRouter>;
}
