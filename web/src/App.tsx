import { useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api } from './api/client';
import { Icon } from './components/Icon';
import { useLiveMessage, useStatus } from './hooks/useLive';
import { Dashboard } from './pages/Dashboard';
import { Reports } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { Tools } from './pages/Tools';
import { UsagePage } from './pages/Usage';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/reports', label: 'Reports' },
  { to: '/tools', label: 'Tools' },
  { to: '/usage', label: 'Data usage' },
  { to: '/settings', label: 'Settings' },
];

function Logo() {
  return (
    <div className="logo">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        {/* A trapline: a route of stations, checked in order. */}
        <path
          d="M3 20 L9 12 L14 15 L23 4"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="3" cy="20" r="2.6" fill="var(--accent)" />
        <circle cx="9" cy="12" r="2.6" fill="var(--accent)" />
        <circle cx="14" cy="15" r="2.6" fill="var(--accent)" />
        <circle cx="23" cy="4" r="2.6" fill="var(--good)" />
      </svg>
      Trapline
    </div>
  );
}

export function App() {
  const { status, connected } = useStatus();
  const [suggestion, setSuggestion] = useState<string | null>(null);

  useLiveMessage('suggestion', (data) => setSuggestion(data.reason));

  const stateColor =
    status?.state === 'down'
      ? 'var(--critical)'
      : status?.state === 'degraded'
        ? 'var(--warning)'
        : 'var(--good)';

  return (
    <div className="app">
      <nav className="sidebar">
        <Logo />
        <div className="nav-route">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span className="station" aria-hidden="true" /> {n.label}
            </NavLink>
          ))}
        </div>
        <div className="nav-state">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 99,
                background: connected ? stateColor : 'var(--muted)',
              }}
            />
            {connected ? (
              <>
                live · {status?.state ?? '…'} · {status?.mode ?? ''} mode
              </>
            ) : (
              'reconnecting…'
            )}
          </div>
        </div>
      </nav>

      <main className="content">
        {suggestion && status?.mode !== 'full' && (
          <div className="banner" role="status">
            <Icon name="search" size={18} />
            <div style={{ flex: 1 }}>
              <strong>Trouble detected — switch to Full Capture?</strong>
              <div className="dim">
                {suggestion}. Full Capture probes much more aggressively to document the problem,
                then reverts automatically.
              </div>
            </div>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                void api.setMode('full');
                setSuggestion(null);
              }}
            >
              Switch
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void api.dismissSuggestion();
                setSuggestion(null);
              }}
            >
              Not now
            </button>
          </div>
        )}

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/tools" element={<Tools />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
