/** Typed fetch wrappers for the Trapline API. */
import type {
  DnsBenchResult,
  HealthCheckResult,
  Mode,
  MonitorEvent,
  MtrResult,
  Settings,
  SpeedTestResult,
  StatusSnapshot,
  SummaryStats,
  Target,
  UsageSummary,
} from '../../../shared/types';

export const API = '/trapline/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the status text
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  status: () => req<StatusSnapshot>('/status'),
  summary: (from: number, to: number) => req<SummaryStats>(`/summary?from=${from}&to=${to}`),
  pingSamples: (from: number, to: number, maxPoints = 2000) =>
    req<{ targetId: number; points: [number, number | null][] }[]>(
      `/samples/ping?from=${from}&to=${to}&maxPoints=${maxPoints}`,
    ),
  speedTests: (from: number, to: number) =>
    req<SpeedTestResult[]>(`/speedtests?from=${from}&to=${to}`),
  runSpeedTest: () => req<{ started: boolean }>('/speedtests', { method: 'POST', body: '{}' }),
  events: (from: number, to: number) => req<MonitorEvent[]>(`/events?from=${from}&to=${to}`),
  recentEvents: () => req<MonitorEvent[]>('/events/recent'),
  eventDetail: (id: number) =>
    req<MonitorEvent & { evidence: { kind: string; capturedAt: number; content: unknown }[] }>(
      `/events/${id}`,
    ),
  usage: (granularity: 'hour' | 'day' | 'month' | 'year', from?: number, to?: number) =>
    req<UsageSummary>(
      `/usage?granularity=${granularity}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`,
    ),
  settings: () => req<Settings>('/settings'),
  saveSettings: (s: Partial<Settings>) =>
    req<Settings>('/settings', { method: 'PUT', body: JSON.stringify(s) }),
  setMode: (mode: Mode, revertAfterMs?: number) =>
    req<StatusSnapshot>('/mode', { method: 'POST', body: JSON.stringify({ mode, revertAfterMs }) }),
  dismissSuggestion: () => req<{ ok: boolean }>('/suggestion/dismiss', { method: 'POST', body: '{}' }),
  targets: () => req<Target[]>('/targets'),
  addTarget: (host: string, label: string) =>
    req<Target>('/targets', { method: 'POST', body: JSON.stringify({ host, label }) }),
  patchTarget: (id: number, patch: { enabled?: boolean }) =>
    req<Target>(`/targets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTarget: (id: number) => req<{ ok: boolean }>(`/targets/${id}`, { method: 'DELETE' }),
  rediscover: () => req<Target[]>('/targets/rediscover', { method: 'POST', body: '{}' }),
  toolPing: (host: string, count = 10) =>
    req<{ host: string; count: number; rtts: (number | null)[]; medianRttMs: number | null; lossPct: number }>(
      '/tools/ping',
      { method: 'POST', body: JSON.stringify({ host, count }) },
    ),
  toolMtr: (host: string) =>
    req<MtrResult>('/tools/mtr', { method: 'POST', body: JSON.stringify({ host }) }),
  dnsBench: () => req<DnsBenchResult[]>('/tools/dns-bench', { method: 'POST', body: '{}' }),
  healthCheck: () => req<HealthCheckResult>('/tools/health-check', { method: 'POST', body: '{}' }),
};

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  return `${(n / 1024 ** 4).toFixed(2)} TB`;
}

export function fmtMbps(bps: number | null): string {
  return bps === null ? '—' : `${(bps / 1e6).toFixed(1)} Mbps`;
}

export function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
