# Configuration reference

Trapline has three layers of configuration: **CLI flags** (per invocation),
**environment variables** (where the process runs and stores data), and **persisted
settings** (user-editable, stored in the database, managed from the Settings page or
`PUT /trapline/api/settings`).

## CLI flags

Accepted by both the standalone binary and a source run (`server/src/index.ts`). Value
flags are applied by setting the corresponding environment variable, so a flag always
overrides an inherited env var.

| Flag | Env equivalent | Effect |
|---|---|---|
| `--port <n>` | `TRAPLINE_PORT` | Bind port (1–65535). |
| `--host <addr>` | `TRAPLINE_HOST` | Bind address. |
| `--data-dir <dir>` | `TRAPLINE_DATA_DIR` | Data directory. |
| `--no-browser` | `TRAPLINE_NO_BROWSER=1` | Don't open the dashboard in a browser on start. Only the standalone binary opens one; source runs never do. |
| `--version`, `-v` | — | Print version (from the root `package.json`, the single source of truth), Node version, and platform, then exit. |
| `--help`, `-h` | — | Print usage and exit. |

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `TRAPLINE_DATA_DIR` | see below | Directory for the SQLite database (`trapline.db`) and its WAL files. Created if missing. |
| `TRAPLINE_HOST` | `127.0.0.1` | Bind address. Loopback by default — see [security](security.md) before changing. |
| `TRAPLINE_PORT` | `8731` | Bind port. The launcher and dev proxy honor it too. |
| `TRAPLINE_NO_BROWSER` | unset | If `1`, the standalone binary doesn't open a browser on start. |
| `LOG_LEVEL` | `info` | Fastify/pino log level. |
| `TRAPLINE_DEBUG` | unset | If set, logs speed-test download stream errors to stderr. |

Defined in `server/src/config.ts` (and read once at startup). `NODE_ENV` is set by the
systemd unit and Dockerfile but not read by application code.

### Default data directory

`TRAPLINE_DATA_DIR` always wins when set. Otherwise the default depends on how Trapline
runs:

| How it runs | Default data directory |
|---|---|
| Source or Docker | `<repo>/data` (Docker maps `TRAPLINE_DATA_DIR=/data` to a volume) |
| Standalone binary — Windows | `%LOCALAPPDATA%\Trapline` |
| Standalone binary — macOS | `~/Library/Application Support/Trapline` |
| Standalone binary — Linux | `$XDG_DATA_HOME/trapline`, or `~/.local/share/trapline` |

## Persisted settings

Defaults in `DEFAULT_SETTINGS` (`server/src/config.ts`); validated server-side on write
(`mergeSettings` in `server/src/api/routes.ts` — unknown keys are rejected).

| Setting | Default | Valid range | Meaning |
|---|---|---|---|
| `mode` | `normal` | `eco` / `normal` / `full` | Probe cadence profile (below). Changed via `POST /mode`, not `PUT /settings`. |
| `plan.ispName` | `Northwestel` | string ≤ 200 chars | Shown in reports. |
| `plan.downMbps`, `plan.upMbps` | `null` | number ≥ 0 or null | Advertised plan speeds; enable speed-vs-plan comparisons. |
| `plan.pricePerMonth` | `null` | number ≥ 0 or null | Context line in reports. |
| `plan.currency` | `CAD` | string ≤ 10 chars | Currency label. |
| `theme` | `dark` | `dark` / `light` | UI default theme (the browser also stores its own preference). |
| `speedtestDownUrl` | `https://speed.cloudflare.com/__down` | http(s) URL | Download-test endpoint (must accept a `bytes` query parameter). |
| `speedtestUpUrl` | `https://speed.cloudflare.com/__up` | http(s) URL | Upload-test endpoint. |
| `speedDegradationFraction` | `0.5` | 0.1 – 1 | A speed test below this fraction of the advertised speed raises a `speed_degradation` event. |
| `latencyThresholdMs` | `120` | 0 – 10000 | Sustained median RTT above this raises a `high_latency` event; 0 disables. |
| `retentionPingDays` | `14` | 1 – 3650 (UI: 3 – 90) | Days of raw ping samples to keep before rollup-only. |
| `retentionDnsHttpDays` | `30` | 1 – 3650 | Days of raw DNS/HTTP samples to keep. |

## Monitoring modes

Cadences per mode (`MODES` in `server/src/config.ts`):

| | Eco | Normal | Full Capture |
|---|---|---|---|
| Ping interval per target | 30 s | 5 s | 1 s |
| WAN targets probed | 1 | up to 3 | up to 3 |
| DNS probe interval | 600 s | 60 s | 15 s |
| HTTP probe interval | 600 s | 60 s | 30 s |
| Scheduled speed tests/day | 1 | 4 | 12 (~every 2 h) |
| mtr evidence rate limit | never | ≥ 5 min apart | ≥ 1 min apart |

Full Capture always auto-reverts to the previous mode after a timer
(`FULL_CAPTURE_DEFAULT_REVERT_MS` = 6 h by default; selectable 1–24 h in the UI).

## Compile-time constants

Also in `server/src/config.ts`, changeable by editing the file:

- `BASE_PATH = '/trapline'` — URL prefix for UI and API.
- `ANCHORS` — public ping anchors: `1.1.1.1` (Cloudflare), `8.8.8.8` (Google).
- `DNS_PROBE_HOSTNAMES` — round-robin lookups: `www.google.com`, `www.northwestel.net`,
  `example.com`.
- `HTTP_PROBE_URLS` — `http://connectivitycheck.gstatic.com/generate_204`,
  `https://www.cloudflare.com/cdn-cgi/trace`.
- `EST_BYTES` — per-probe wire-byte estimates used by the usage ledger.

Detection thresholds live as named constants in `server/src/monitor/detector.ts` and are
documented in [methodology](methodology.md).
