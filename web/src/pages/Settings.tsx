import { useEffect, useState } from 'react';
import type { Settings, Target } from '../../../shared/types';
import { api } from '../api/client';
import { Tooltip } from '../components/Tooltip';
import { useStatus } from '../hooks/useLive';
import { useTheme } from '../hooks/useTheme';

export function SettingsPage() {
  const { status } = useStatus();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [saved, setSaved] = useState(false);
  const [theme, setTheme] = useTheme();
  const [newHost, setNewHost] = useState('');
  const [newLabel, setNewLabel] = useState('');

  useEffect(() => {
    void api.settings().then(setSettings).catch(() => {});
    void api.targets().then(setTargets).catch(() => {});
  }, []);

  const save = async (): Promise<void> => {
    if (!settings) return;
    setSettings(await api.saveSettings(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const refreshTargets = async (): Promise<void> => setTargets(await api.targets());

  if (!settings) return <span className="spin" />;

  const num = (v: string): number | null => (v === '' ? null : Number(v));

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">
        Tell Trapline about your plan so reports can compare measured speed against what you pay
        for.
      </p>

      {status && !status.mtrAvailable && (
        <div className="banner">
          <span aria-hidden="true">⚠️</span>
          <div>
            <strong>Route tracing (mtr) is unavailable</strong>
            <div className="dim">
              Events will be recorded without route evidence. Fix on this machine:{' '}
              <code>sudo apt install mtr-tiny</code>
            </div>
          </div>
        </div>
      )}

      <div className="section card" style={{ maxWidth: 560 }}>
        <h3>
          Your internet plan
          <Tooltip text="Copied straight from your bill. Trapline uses this to flag speed tests that come in far below what's advertised, and to show plan reference lines on charts." />
        </h3>
        <div className="form-row">
          <label>ISP name</label>
          <input
            value={settings.plan.ispName}
            onChange={(e) => setSettings({ ...settings, plan: { ...settings.plan, ispName: e.target.value } })}
          />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="form-row" style={{ flex: 1 }}>
            <label>Download (Mbps)</label>
            <input
              type="number"
              min="0"
              value={settings.plan.downMbps ?? ''}
              onChange={(e) => setSettings({ ...settings, plan: { ...settings.plan, downMbps: num(e.target.value) } })}
            />
          </div>
          <div className="form-row" style={{ flex: 1 }}>
            <label>Upload (Mbps)</label>
            <input
              type="number"
              min="0"
              value={settings.plan.upMbps ?? ''}
              onChange={(e) => setSettings({ ...settings, plan: { ...settings.plan, upMbps: num(e.target.value) } })}
            />
          </div>
          <div className="form-row" style={{ flex: 1 }}>
            <label>Price / month</label>
            <input
              type="number"
              min="0"
              value={settings.plan.pricePerMonth ?? ''}
              onChange={(e) =>
                setSettings({ ...settings, plan: { ...settings.plan, pricePerMonth: num(e.target.value) } })
              }
            />
          </div>
        </div>
        <div className="form-row">
          <label>
            Slow-speed alert threshold
            <Tooltip text="A speed test below this fraction of your advertised download speed is recorded as a 'slow speed' event. 0.5 means: flag anything under half of what you pay for." />
          </label>
          <input
            type="number"
            min="0.1"
            max="1"
            step="0.05"
            value={settings.speedDegradationFraction}
            onChange={(e) => setSettings({ ...settings, speedDegradationFraction: Number(e.target.value) })}
          />
        </div>
        <div className="btn-row">
          <button type="button" className="btn primary" onClick={() => void save()}>
            Save
          </button>
          {saved && <span style={{ color: 'var(--good)' }}>Saved ✓</span>}
        </div>
      </div>

      <div className="section card" style={{ maxWidth: 720 }}>
        <h3>
          Probe targets
          <Tooltip text="The addresses Trapline pings continuously. The router and ISP hop are discovered automatically — the comparison between them is what proves whose fault an outage is. You can add your own targets (e.g. a work VPN or game server) to watch too." />
        </h3>
        <table className="data">
          <thead>
            <tr>
              <th>Label</th>
              <th>Address</th>
              <th>Kind</th>
              <th>Enabled</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.id}>
                <td>{t.label}</td>
                <td>
                  <code>{t.host}</code>
                </td>
                <td>
                  <span className="chip">{t.kind.replace('_', ' ')}</span>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={t.enabled}
                    aria-label={`Enable ${t.label}`}
                    onChange={(e) =>
                      void api.patchTarget(t.id, { enabled: e.target.checked }).then(refreshTargets)
                    }
                  />
                </td>
                <td>
                  {t.kind === 'custom' && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '2px 10px', fontSize: 12 }}
                      onClick={() => void api.deleteTarget(t.id).then(refreshTargets)}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <input
            placeholder="host or IP"
            value={newHost}
            onChange={(e) => setNewHost(e.target.value)}
            aria-label="New target host"
            style={{ width: 160 }}
          />
          <input
            placeholder="label (optional)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            aria-label="New target label"
            style={{ width: 160 }}
          />
          <button
            type="button"
            className="btn"
            disabled={!newHost.trim()}
            onClick={() =>
              void api.addTarget(newHost.trim(), newLabel.trim() || newHost.trim()).then(() => {
                setNewHost('');
                setNewLabel('');
                void refreshTargets();
              })
            }
          >
            Add target
          </button>
          <button type="button" className="btn" onClick={() => void api.rediscover().then(setTargets)}>
            Re-discover router & ISP hop
            <Tooltip text="Re-detects your router address and the ISP's first hop. Run this after changing routers or if the ISP re-routed your connection." />
          </button>
        </div>
      </div>

      <div className="section card" style={{ maxWidth: 560 }}>
        <h3>
          Appearance & data retention
        </h3>
        <div className="form-row">
          <label>Theme</label>
          <div className="seg">
            <button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>
              🌙 Dark
            </button>
            <button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>
              ☀️ Light
            </button>
          </div>
        </div>
        <div className="form-row">
          <label>
            Keep raw probe records for (days)
            <Tooltip text="Individual ping results are huge in volume, so they're condensed into hourly summaries after this many days. Events, evidence, speed tests and hourly summaries are kept forever regardless." />
          </label>
          <input
            type="number"
            min="3"
            max="90"
            value={settings.retentionPingDays}
            onChange={(e) => setSettings({ ...settings, retentionPingDays: Number(e.target.value) })}
          />
        </div>
        <div className="btn-row">
          <button type="button" className="btn primary" onClick={() => void save()}>
            Save
          </button>
          {saved && <span style={{ color: 'var(--good)' }}>Saved ✓</span>}
        </div>
      </div>

      <p className="dim">
        Trapline v{status?.version ?? '…'} · monitoring since{' '}
        {status ? new Date(status.serverStartedAt).toLocaleString() : '…'} (this run) · open source,
        MIT licensed
      </p>
    </div>
  );
}
