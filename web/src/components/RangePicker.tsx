import { useState } from 'react';

export interface Range {
  from: number;
  to: number;
  label: string;
}

const DAY = 86_400_000;

export function presetRange(label: string, days: number): Range {
  const to = Date.now();
  return { from: to - days * DAY, to, label };
}

const PRESETS: { label: string; days: number }[] = [
  { label: 'Last 24 hours', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const applyCustom = (): void => {
    if (!customFrom) return;
    const from = new Date(customFrom).getTime();
    const to = customTo ? new Date(customTo).getTime() + DAY - 1 : Date.now();
    if (Number.isNaN(from) || Number.isNaN(to) || from >= to) return;
    onChange({ from, to, label: 'Custom range' });
  };

  return (
    <div className="btn-row" style={{ marginBottom: 18 }}>
      <div className="seg" role="group" aria-label="Time range">
        {PRESETS.map((p) => (
          <button
            type="button"
            key={p.label}
            className={value.label === p.label ? 'active' : ''}
            onClick={() => onChange(presetRange(p.label, p.days))}
          >
            {p.label}
          </button>
        ))}
      </div>
      <span className="dim">or</span>
      <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="From date" />
      <span className="dim">to</span>
      <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="To date" />
      <button type="button" className="btn" onClick={applyCustom}>
        Apply
      </button>
    </div>
  );
}
