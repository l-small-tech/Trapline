export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Start of the UTC hour containing `ts`. */
export function hourStart(ts: number): number {
  return Math.floor(ts / HOUR) * HOUR;
}

/** Start of the UTC day containing `ts`. */
export function dayStartUtc(ts: number): number {
  return Math.floor(ts / DAY) * DAY;
}

export function isoUtc(ts: number): string {
  return new Date(ts).toISOString();
}

/** Local-time string with offset, for human-facing evidence output. */
export function isoLocal(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function formatDuration(ms: number): string {
  if (ms < MINUTE) return `${Math.round(ms / 100) / 10}s`;
  if (ms < HOUR) {
    const m = Math.floor(ms / MINUTE);
    const s = Math.round((ms % MINUTE) / SECOND);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(ms / HOUR);
  const m = Math.round((ms % HOUR) / MINUTE);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
