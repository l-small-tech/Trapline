import { useState } from 'react';
import type { Mode, StatusSnapshot } from '../../../shared/types';
import { api, fmtBytes, fmtDuration } from '../api/client';
import { Tooltip } from './Tooltip';

const MODES: {
  mode: Mode;
  name: string;
  icon: string;
  desc: string;
  dataNote: string;
}[] = [
  {
    mode: 'eco',
    name: 'Eco',
    icon: '🌱',
    desc: 'Bare-minimum checks: one probe every 30 seconds and one speed test per night. For homes with small data caps.',
    dataNote: 'uses the least data',
  },
  {
    mode: 'normal',
    name: 'Normal',
    icon: '📡',
    desc: 'Recommended. Continuous probing of your router, the ISP network, and the wider internet, plus a few speed tests a day. You will not notice it.',
    dataNote: 'balanced',
  },
  {
    mode: 'full',
    name: 'Full Capture',
    icon: '🔍',
    desc: 'Turn this on while the internet feels broken. Probes every second and tests speed every 2 hours to capture maximum evidence. Automatically switches back.',
    dataNote: 'heaviest — auto-reverts',
  },
];

const REVERT_CHOICES: { label: string; ms: number }[] = [
  { label: '1 hour', ms: 3_600_000 },
  { label: '3 hours', ms: 3 * 3_600_000 },
  { label: '6 hours', ms: 6 * 3_600_000 },
  { label: '12 hours', ms: 12 * 3_600_000 },
  { label: '24 hours', ms: 24 * 3_600_000 },
];

export function ModeSwitcher({
  status,
  projections,
}: {
  status: StatusSnapshot;
  projections?: Record<Mode, number>;
}) {
  const [revertMs, setRevertMs] = useState(6 * 3_600_000);
  const [busy, setBusy] = useState(false);

  const switchMode = async (mode: Mode): Promise<void> => {
    setBusy(true);
    try {
      await api.setMode(mode, mode === 'full' ? revertMs : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, display: 'flex', gap: 6 }}>
        Monitoring mode
        <Tooltip text="How aggressively Trapline probes your connection. More probing = better evidence but more data used. The projected monthly data use for each mode is shown on its card." />
      </h3>
      <div className="mode-cards">
        {MODES.map((m) => (
          <button
            type="button"
            key={m.mode}
            disabled={busy}
            className={`mode-card ${status.mode === m.mode ? 'active' : ''}`}
            onClick={() => void switchMode(m.mode)}
          >
            <div className="mode-name">
              <span aria-hidden="true">{m.icon}</span> {m.name}
              {status.mode === m.mode && <span className="chip">current</span>}
            </div>
            <div className="mode-desc">{m.desc}</div>
            <div className="mode-data">
              {projections ? `~${fmtBytes(projections[m.mode])} / month` : m.dataNote}
            </div>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="dim">Full Capture switches back to Normal after</span>
        <select value={revertMs} onChange={(e) => setRevertMs(Number(e.target.value))}>
          {REVERT_CHOICES.map((c) => (
            <option key={c.ms} value={c.ms}>
              {c.label}
            </option>
          ))}
        </select>
        {status.mode === 'full' && status.revertAt !== null && (
          <span className="chip">reverting in {fmtDuration(Math.max(0, status.revertAt - Date.now()))}</span>
        )}
      </div>
    </div>
  );
}
