/**
 * Minimal pino prettifier for interactive terminals. Replaces the
 * pino-pretty transport: transports resolve a module by name at runtime and
 * run it in a worker thread, which cannot work inside a bundled single-file
 * executable. This is a plain synchronous stream with zero dependencies.
 */
import type { Writable } from 'node:stream';

const LEVELS: Record<number, { name: string; color: string }> = {
  10: { name: 'TRACE', color: '\x1b[90m' },
  20: { name: 'DEBUG', color: '\x1b[90m' },
  30: { name: 'INFO ', color: '\x1b[36m' },
  40: { name: 'WARN ', color: '\x1b[33m' },
  50: { name: 'ERROR', color: '\x1b[31m' },
  60: { name: 'FATAL', color: '\x1b[41m' },
};
const RESET = '\x1b[0m';
const DIM = '\x1b[90m';

interface PinoLine {
  time?: number;
  level?: number;
  msg?: string;
  err?: { message?: string; stack?: string };
  req?: { method?: string; url?: string };
  res?: { statusCode?: number };
  responseTime?: number;
}

function formatLine(json: string, useColor: boolean): string {
  const rec = JSON.parse(json) as PinoLine;
  const t = new Date(rec.time ?? Date.now());
  const hms = [t.getHours(), t.getMinutes(), t.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  const lvl = LEVELS[rec.level ?? 30] ?? LEVELS[30]!;
  let msg = rec.msg ?? '';
  if (rec.req?.method) msg = `${rec.req.method} ${rec.req.url ?? ''} ${msg}`.trim();
  if (rec.res?.statusCode !== undefined) {
    msg += ` ${DIM}(${rec.res.statusCode}${rec.responseTime !== undefined ? ` ${rec.responseTime.toFixed(0)}ms` : ''})${useColor ? RESET : ''}`;
  }
  let line = useColor
    ? `${DIM}${hms}${RESET} ${lvl.color}${lvl.name}${RESET} ${msg}`
    : `${hms} ${lvl.name} ${msg}`;
  if (rec.err?.stack) line += `\n${rec.err.stack}`;
  else if (rec.err?.message) line += `\n  ${rec.err.message}`;
  return line;
}

/** A pino destination that pretty-prints NDJSON records to `out`. */
export function createPrettyStream(out: Writable & { isTTY?: boolean }): { write(s: string): void } {
  const useColor = out.isTTY === true;
  return {
    write(chunk: string): void {
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        try {
          out.write(formatLine(line, useColor) + '\n');
        } catch {
          out.write(line + '\n'); // not JSON — pass through untouched
        }
      }
    },
  };
}
