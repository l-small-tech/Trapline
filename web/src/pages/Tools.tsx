import { useCallback, useState } from 'react';
import type {
  DnsBenchResult,
  HealthCheckResult,
  MtrResult,
  SpeedTestProgress,
  SpeedTestResult,
} from '../../../shared/types';
import { api, fmtMbps } from '../api/client';
import { GradeBadge } from '../components/GradeBadge';
import { Tooltip } from '../components/Tooltip';
import { useLiveMessage } from '../hooks/useLive';

export function Tools() {
  return (
    <div>
      <h1 className="page-title">Tools</h1>
      <p className="page-sub">
        On-demand checks for when you want an answer right now. Results are shown here (and speed
        tests are also saved to the history).
      </p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <SpeedTestTool />
        <HealthCheckTool />
        <DnsBenchTool />
        <PingTool />
        <MtrTool />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ speed test

function SpeedTestTool() {
  const [progress, setProgress] = useState<SpeedTestProgress | null>(null);
  const [result, setResult] = useState<SpeedTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useLiveMessage(
    'speedtest',
    useCallback((data: { progress?: SpeedTestProgress; result?: SpeedTestResult }) => {
      if (data.progress) setProgress(data.progress);
      if (data.result) {
        setResult(data.result);
        setProgress(null);
      }
    }, []),
  );

  const running = progress !== null && progress.phase !== 'done' && progress.phase !== 'error';

  const start = async (): Promise<void> => {
    setError(null);
    setResult(null);
    try {
      await api.runSpeedTest();
      setProgress({ phase: 'idle_latency', currentBps: 0, elapsedMs: 0 });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const PHASE_LABEL: Record<string, string> = {
    idle_latency: 'Measuring idle latency…',
    preflight: 'Sizing the test…',
    download: 'Testing download…',
    upload: 'Testing upload…',
  };

  return (
    <div className="card">
      <h3>
        Speed test
        <Tooltip text="Measures real download/upload throughput against Cloudflare's speed servers plus how laggy the line gets under load (bufferbloat). Uses roughly 100–300 MB of data per run." />
      </h3>
      <div className="btn-row">
        <button type="button" className="btn primary" disabled={running} onClick={() => void start()}>
          {running ? 'Running…' : 'Run speed test'}
        </button>
        {running && (
          <>
            <span className="spin" />
            <span className="dim">
              {PHASE_LABEL[progress.phase] ?? progress.phase}{' '}
              {(progress.phase === 'download' || progress.phase === 'upload') &&
                `${(progress.currentBps / 1e6).toFixed(1)} Mbps`}
            </span>
          </>
        )}
      </div>
      {error && <p style={{ color: 'var(--critical)', marginTop: 8 }}>{error}</p>}
      {result && (
        <div className="tiles" style={{ marginTop: 14, gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div>
            <div className="tile-label">Download</div>
            <div className="tile-value" style={{ fontSize: 22 }}>{fmtMbps(result.downBps)}</div>
          </div>
          <div>
            <div className="tile-label">Upload</div>
            <div className="tile-value" style={{ fontSize: 22 }}>{fmtMbps(result.upBps)}</div>
          </div>
          <div>
            <div className="tile-label">Idle latency</div>
            <div className="tile-value" style={{ fontSize: 22 }}>
              {result.idleLatencyMs != null ? `${result.idleLatencyMs.toFixed(0)} ms` : '—'}
            </div>
          </div>
          <div>
            <div className="tile-label">Under load</div>
            <div className="tile-value" style={{ fontSize: 22 }}>
              <GradeBadge grade={result.bufferbloatGrade} />
            </div>
          </div>
          {result.error && <p style={{ color: 'var(--critical)' }}>{result.error}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------- health check

function HealthCheckTool() {
  const [result, setResult] = useState<HealthCheckResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      setResult(await api.healthCheck());
    } finally {
      setBusy(false);
    }
  };

  const color =
    result?.verdict === 'good' ? 'var(--good)' : result?.verdict === 'degraded' ? 'var(--warning)' : 'var(--critical)';

  return (
    <div className="card">
      <h3>
        Test now
        <Tooltip text="A 10-second all-in-one check: pings every probe target, resolves a hostname, and fetches a web page. The quickest way to answer 'is it me or the ISP?'" />
      </h3>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void run()}>
        {busy ? 'Checking…' : 'Run health check'}
      </button>
      {busy && <span className="spin" style={{ marginLeft: 10 }} />}
      {result && (
        <div style={{ marginTop: 12 }}>
          <strong style={{ color }}>{result.verdict.toUpperCase()}</strong>
          <p className="dim">{result.explanation}</p>
          <table className="data" style={{ marginTop: 8 }}>
            <tbody>
              {result.ping.map((p) => (
                <tr key={p.host}>
                  <td>{p.label}</td>
                  <td className="num">
                    {p.medianRttMs != null ? `${p.medianRttMs.toFixed(1)} ms` : 'no reply'}
                  </td>
                  <td className="num" style={{ color: p.lossPct > 0 ? 'var(--critical)' : undefined }}>
                    {p.lossPct.toFixed(0)}% loss
                  </td>
                </tr>
              ))}
              <tr>
                <td>DNS lookup</td>
                <td className="num">{result.dns.durationMs?.toFixed(0) ?? '—'} ms</td>
                <td style={{ color: result.dns.ok ? 'var(--good)' : 'var(--critical)' }}>
                  {result.dns.ok ? 'OK' : result.dns.error}
                </td>
              </tr>
              <tr>
                <td>Web fetch</td>
                <td className="num">{result.http.ttfbMs?.toFixed(0) ?? '—'} ms</td>
                <td style={{ color: result.http.ok ? 'var(--good)' : 'var(--critical)' }}>
                  {result.http.ok ? 'OK' : result.http.error}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- dns bench

function DnsBenchTool() {
  const [results, setResults] = useState<DnsBenchResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      setResults(await api.dnsBench());
    } finally {
      setBusy(false);
    }
  };

  const max = results ? Math.max(...results.map((r) => r.medianMs ?? 0), 1) : 1;

  return (
    <div className="card">
      <h3>
        DNS speed check
        <Tooltip text="DNS is the internet's phone book — every website visit starts with a lookup. This compares the resolver your machine actually uses against popular public ones. If 'System resolver' is much slower, switching your router's DNS can make browsing feel faster." />
      </h3>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void run()}>
        {busy ? 'Benchmarking…' : 'Compare resolvers'}
      </button>
      {busy && <span className="spin" style={{ marginLeft: 10 }} />}
      {results && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {results.map((r) => (
            <div key={r.resolver}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span>{r.label}</span>
                <span className="dim">
                  {r.medianMs != null ? `${r.medianMs.toFixed(0)} ms` : 'failed'}
                  {r.successPct < 100 && ` · ${r.successPct.toFixed(0)}% ok`}
                </span>
              </div>
              <div style={{ background: 'var(--surface-2)', borderRadius: 4, height: 8 }}>
                <div
                  style={{
                    width: `${((r.medianMs ?? max) / max) * 100}%`,
                    height: 8,
                    borderRadius: 4,
                    background: r.resolver === 'system' ? 'var(--series-1)' : 'var(--baseline)',
                  }}
                />
              </div>
            </div>
          ))}
          <p className="dim">Shorter bar = faster. Your system resolver is highlighted in blue.</p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ping

function PingTool() {
  const [host, setHost] = useState('1.1.1.1');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Awaited<ReturnType<typeof api.toolPing>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setOut(await api.toolPing(host.trim(), 10));
    } catch (e) {
      setError((e as Error).message);
      setOut(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>
        Ping a host
        <Tooltip text="Sends 10 probes to any address and reports the round-trip time and loss. Try your router, a game server, or a website." />
      </h3>
      <div className="btn-row">
        <input value={host} onChange={(e) => setHost(e.target.value)} aria-label="Host to ping" style={{ width: 180 }} />
        <button type="button" className="btn primary" disabled={busy || !host.trim()} onClick={() => void run()}>
          {busy ? 'Pinging…' : 'Ping'}
        </button>
      </div>
      {error && <p style={{ color: 'var(--critical)', marginTop: 8 }}>{error}</p>}
      {out && (
        <p style={{ marginTop: 10 }}>
          <strong>{out.medianRttMs != null ? `${out.medianRttMs.toFixed(1)} ms median` : 'No replies'}</strong>
          <span className="dim"> · {out.lossPct.toFixed(0)}% loss over {out.count} probes</span>
          <br />
          <span className="dim">
            {out.rtts.map((r) => (r === null ? '✕' : r.toFixed(0))).join(' · ')} ms
          </span>
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- mtr

function MtrTool() {
  const [host, setHost] = useState('1.1.1.1');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<MtrResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setOut(await api.toolMtr(host.trim()));
    } catch (e) {
      setError((e as Error).message);
      setOut(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ gridColumn: '1 / -1' }}>
      <h3>
        Trace the route (mtr)
        <Tooltip text="Shows every network 'hop' between you and a destination, with per-hop loss and latency — the tool that reveals exactly where on the path packets are dying. Takes about 15 seconds." />
      </h3>
      <div className="btn-row">
        <input value={host} onChange={(e) => setHost(e.target.value)} aria-label="Host to trace" style={{ width: 180 }} />
        <button type="button" className="btn primary" disabled={busy || !host.trim()} onClick={() => void run()}>
          {busy ? 'Tracing… (~15 s)' : 'Trace route'}
        </button>
        {busy && <span className="spin" />}
      </div>
      {error && <p style={{ color: 'var(--critical)', marginTop: 8 }}>{error}</p>}
      {out && (
        <div className="table-scroll" style={{ marginTop: 10 }}>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Hop</th>
                <th>Loss</th>
                <th>Best</th>
                <th>Avg</th>
                <th>Worst</th>
              </tr>
            </thead>
            <tbody>
              {out.hops.map((h) => (
                <tr key={h.hop}>
                  <td className="num">{h.hop}</td>
                  <td>
                    {h.host} {h.ip !== h.host && <span className="dim">({h.ip})</span>}
                  </td>
                  <td className="num" style={{ color: h.lossPct > 0 ? 'var(--critical)' : undefined }}>
                    {h.lossPct.toFixed(0)}%
                  </td>
                  <td className="num">{h.best.toFixed(1)}</td>
                  <td className="num">{h.avg.toFixed(1)}</td>
                  <td className="num">{h.worst.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
