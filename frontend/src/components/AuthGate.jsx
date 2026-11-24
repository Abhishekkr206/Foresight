import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { endSession, getJson, getToken, setToken } from '../services/api';

const inputClass = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2';

function LoginForm({ onLogin }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const session = await getJson('/api/auth/login', {
        method: 'POST',
        authenticated: false,
        timeoutMs: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_id: data.get('login_id'), password: data.get('password') }),
      });
      onLogin(session);
    } catch (failure) {
      setError(failure.status === 401 ? 'Invalid login ID or password.' : 'Sign-in is unavailable. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="grid min-h-dvh place-items-center bg-slate-100 px-5">
    <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
      <img src="/logo.png" alt="Foresight" className="h-12 w-auto object-contain" />
      <h1 className="text-2xl font-semibold text-slate-900">Sign in to Foresight</h1>
      <label className="block text-sm font-medium">Login ID
        <input className={inputClass} name="login_id" autoComplete="username" required />
      </label>
      <label className="block text-sm font-medium">Password
        <input className={inputClass} name="password" type="password" autoComplete="current-password" required />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-[#366044] px-4 py-2 font-semibold text-white disabled:opacity-60">
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  </main>;
}

export default function AuthGate() {
  const location = useLocation();
  const [status, setStatus] = useState(() => getToken() ? 'checking' : 'signed-out');
  const [expiresAt, setExpiresAt] = useState(null);

  useEffect(() => {
    const signOut = () => {
      setExpiresAt(null);
      setStatus('signed-out');
    };
    window.addEventListener('foresight:sign-out', signOut);
    return () => window.removeEventListener('foresight:sign-out', signOut);
  }, []);

  useEffect(() => {
    if (status !== 'checking') return;
    const controller = new AbortController();
    getJson('/api/auth/session', { signal: controller.signal }).then((session) => {
      if (controller.signal.aborted) return;
      setExpiresAt(session.expires_at * 1000);
      setStatus('signed-in');
    }).catch(() => {
      if (!controller.signal.aborted && getToken()) setStatus('unavailable');
    });
    return () => controller.abort();
  }, [status]);

  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(endSession, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  if (status === 'checking') return <p className="p-6" role="status">Checking your session…</p>;
  if (status === 'unavailable') return <div className="space-y-3 p-6">
    <p role="alert">Unable to check your session.</p>
    <button className="mr-4 underline" onClick={() => setStatus('checking')}>Retry</button>
    <button className="underline" onClick={endSession}>Sign out</button>
  </div>;

  if (location.pathname.toLowerCase().replace(/\/+$/, '') === '/login') {
    if (status === 'signed-in') {
      return <Navigate to={location.state?.returnTo || '/dashboard'} replace />;
    }
    return <LoginForm onLogin={(session) => {
      setToken(session.access_token);
      setExpiresAt(Date.now() + session.expires_in * 1000);
      setStatus('signed-in');
    }} />;
  }

  if (status === 'signed-out') {
    return <Navigate to="/login" state={{ returnTo: location.pathname + location.search + location.hash }} replace />;
  }
  return <Outlet />;
}
