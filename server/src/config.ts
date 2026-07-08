import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Mode } from '../../shared/types.js';
import { isSea } from './sea.js';
import { platformDataDir } from './util/dataDir.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (trapline/). Meaningless inside the standalone executable. */
export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const DATA_DIR =
  process.env.TRAPLINE_DATA_DIR ?? (isSea() ? platformDataDir() : path.join(ROOT_DIR, 'data'));
export const DB_PATH = path.join(DATA_DIR, 'trapline.db');
export const WEB_DIST = path.join(ROOT_DIR, 'web', 'dist');

export const HOST = process.env.TRAPLINE_HOST ?? '127.0.0.1';
export const PORT = Number(process.env.TRAPLINE_PORT ?? 8731);
export const BASE_PATH = '/trapline';

/** Injected by esbuild --define in release builds; see scripts/build-sea.mjs. */
declare const __APP_VERSION__: string | undefined;
/** Single source of truth is the root package.json "version". */
export const VERSION: string =
  typeof __APP_VERSION__ === 'string'
    ? __APP_VERSION__
    : (JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')) as { version: string })
        .version;

/** Public anchor hosts probed in addition to the gateway and the ISP's first hop. */
export const ANCHORS = [
  { host: '1.1.1.1', label: 'Cloudflare DNS (anchor)' },
  { host: '8.8.8.8', label: 'Google DNS (anchor)' },
];

/** Hostnames resolved (round-robin) by the DNS health probe. */
export const DNS_PROBE_HOSTNAMES = ['www.google.com', 'www.northwestel.net', 'example.com'];

/** URLs fetched by the HTTP reachability probe. */
export const HTTP_PROBE_URLS = [
  'http://connectivitycheck.gstatic.com/generate_204',
  'https://www.cloudflare.com/cdn-cgi/trace',
];

export interface ModeConfig {
  /** Ping interval per target, seconds. */
  pingIntervalSec: number;
  /** Use only gateway + first anchor in eco mode. */
  maxWanTargets: number;
  dnsIntervalSec: number;
  httpIntervalSec: number;
  /** How many HTTP probe URLs to rotate through. */
  httpUrls: number;
  /** Scheduled speed tests per day. */
  speedTestsPerDay: number;
  /** Capture mtr evidence on anomalies at most this often (ms); null = never. */
  mtrMinGapMs: number | null;
}

export const MODES: Record<Mode, ModeConfig> = {
  eco: {
    pingIntervalSec: 30,
    maxWanTargets: 1,
    dnsIntervalSec: 600,
    httpIntervalSec: 600,
    httpUrls: 1,
    speedTestsPerDay: 1,
    mtrMinGapMs: null,
  },
  normal: {
    pingIntervalSec: 5,
    maxWanTargets: 3,
    dnsIntervalSec: 60,
    httpIntervalSec: 60,
    httpUrls: 2,
    speedTestsPerDay: 4,
    mtrMinGapMs: 5 * 60 * 1000,
  },
  full: {
    pingIntervalSec: 1,
    maxWanTargets: 3,
    dnsIntervalSec: 15,
    httpIntervalSec: 30,
    httpUrls: 2,
    speedTestsPerDay: 12, // every ~2h
    mtrMinGapMs: 60 * 1000,
  },
};

/** Default auto-revert delay when entering Full Capture. */
export const FULL_CAPTURE_DEFAULT_REVERT_MS = 6 * 60 * 60 * 1000;

/** Estimated wire bytes per probe (both directions combined), used for the usage ledger. */
export const EST_BYTES = {
  pingRoundTrip: 200, // 84B IP+ICMP each way + ethernet framing
  dnsQuery: 300,
  mtrTrace: 15_000, // ~10 probes × ~15 hops × ~100B
};

export const DEFAULT_SETTINGS = {
  mode: 'normal' as Mode,
  plan: {
    ispName: 'Northwestel',
    downMbps: null as number | null,
    upMbps: null as number | null,
    pricePerMonth: null as number | null,
    currency: 'CAD',
  },
  theme: 'dark' as const,
  speedtestDownUrl: 'https://speed.cloudflare.com/__down',
  speedtestUpUrl: 'https://speed.cloudflare.com/__up',
  speedDegradationFraction: 0.5,
  latencyThresholdMs: 120,
  retentionPingDays: 14,
  retentionDnsHttpDays: 30,
};
