# Architecture

Trapline is a two-package npm workspace: a TypeScript server (Fastify 5, run directly via
`tsx`, no compile step) and a React 18 + Vite web UI, with DTOs shared through
`shared/types.ts`.

```
trapline/
├── trapline                  bash launcher (build/setup/start/stop/status/logs/mode)
├── deploy/                   nginx location config, systemd unit template, auto-update script
├── shared/types.ts           DTOs shared by server and UI
├── server/  (Fastify 5, TypeScript, tsx, Node ≥ 22)
│   └── src/
│       ├── config.ts         env vars, mode cadences, default settings, probe endpoints
│       ├── index.ts          bootstrap: DB → migrate → wire components → listen
│       ├── probes/           ping, mtr, dns, http, gateway/ISP-hop discovery
│       ├── monitor/          scheduler, detector, evidence, rollup, usage
│       ├── speedtest/        multi-stream HTTP engine + loaded-latency sampling
│       ├── api/              REST routes, SSE hub, report generation (HTML/CSV/JSON)
│       ├── db/               better-sqlite3 adapter, migrations, all SQL (repo.ts)
│       └── util/             stats, MOS (ITU-T G.107), time helpers
└── web/     (React 18 + React Router 6 + Vite 5 + uPlot)
    └── src/                  pages/ (Dashboard, Reports, Tools, Usage, Settings),
                              components/, api/ (fetch client + SSE), hooks/
```

## Data flow

```
probes ──samples──▶ Scheduler ──▶ Repo (SQLite)          raw storage
                        │  └────▶ SseHub                  live UI updates (≤2 s)
                        ▼
                    Detector (in-memory state machines)
                        │ open/close events
                        ▼
                    Scheduler.handleEventOpen/Close ──▶ Repo (events)
                        │                               └─▶ SseHub
                        ▼
                    EvidenceCollector (mtr trace + ±120 s ping window → event_evidence)

RollupJob (hourly) ──▶ *_rollups_hourly, then purges raw samples past retention
api/reports.ts     ──▶ summaries from rollups + raw   ──▶ reportHtml.ts / CSV / JSON
```

### Server modules

- **`probes/ping.ts`** — one long-lived `ping -n -O -W 3 -i <interval> <host>` child
  process per target; stdout parsed line-by-line (`parsePingLine`, unit-tested); losses
  inferred from `-O` "no answer yet" lines and sequence gaps; auto-restart with backoff.
- **`probes/mtr.ts`** — `runMtr(host, cycles)` spawns `mtr --json`; a startup self-test
  against 127.0.0.1 detects missing raw-socket capability so the UI can warn.
- **`probes/dns.ts`** — timed lookups via `node:dns` Resolver (2 s timeout); also the
  resolver-benchmark fixtures for the Tools page.
- **`probes/http.ts`** — small `undici` fetches with time-to-first-byte measurement.
- **`probes/discovery.ts`** — default gateway from `ip -j route show default`; ISP first
  hop = first *public* responding hop of an mtr trace (RFC1918/CGNAT-aware).
- **`monitor/scheduler.ts`** — owns all recurring work: spawns/reloads ping probes on
  target changes, DNS/HTTP timers, randomized speed-test scheduling, Full-Capture
  auto-revert, monitor-gap detection, SSE status broadcasts. On restart it closes events
  orphaned by a crash and records a `monitor_gap` instead of guessing.
- **`monitor/detector.ts`** — pure, in-memory, fully unit-testable state machines for
  outage / packet loss / latency spike / high latency / DNS failure, plus fault
  classification (`lan`/`isp`/`upstream`/`unknown`). All thresholds are named constants
  at the top of the file; see [methodology](methodology.md).
- **`monitor/evidence.ts`** — on event open, fires rate-limited mtr traces (to an anchor
  and the ISP hop); on close, attaches the surrounding ±120 s of ping samples (capped).
- **`monitor/rollup.ts`** — hourly UPSERT aggregation of raw samples into
  `*_rollups_hourly`; daily retention purge (~04:10 local) + incremental vacuum.
- **`monitor/usage.ts`** — in-memory byte ledger for every measurement, flushed to
  `data_usage_hourly` each minute; powers the Data-usage page.
- **`speedtest/`** — `engine.ts` orchestrates idle latency → preflight → download
  (5 parallel streams) → upload (3 streams) → bufferbloat grade from loaded-vs-idle
  latency. Endpoints default to Cloudflare's public speed service and are configurable.
- **`api/`** — `routes.ts` (REST; see [api.md](api.md)), `sse.ts` (SSE hub),
  `reports.ts` (period summaries, CSV/JSON payloads), `reportHtml.ts` (self-contained
  HTML report with inline SVG charts; all interpolated strings HTML-escaped).
- **`db/`** — `db.ts` opens better-sqlite3 in WAL mode; `migrations.ts` is a versioned,
  append-only migration list; `repo.ts` contains **all** SQL as prepared, parameterized
  statements.

### Web UI

Served under `/trapline/` (Vite `base`, router `basename`) either by the Node server
itself (`@fastify/static` + SPA fallback) or by nginx from `web/dist`. All API access
goes through `web/src/api/client.ts` (typed fetch wrapper, relative base `/trapline/api`)
and `web/src/api/live.ts` (an `EventSource` singleton for the SSE stream). No secrets,
no auth logic, no `dangerouslySetInnerHTML`.

## Database schema

Single SQLite file `data/trapline.db` (WAL). Tables (created in
`server/src/db/migrations.ts`):

| Table | Contents |
|---|---|
| `settings` | key/value JSON blob of user settings |
| `targets` | probe targets: kind (`gateway`/`isp_hop`/`anchor`/`custom`), host (unique), label, `is_lan`, enabled |
| `ping_samples` | raw per-probe results (ts, target, rtt or null) — retained `retentionPingDays` |
| `dns_samples`, `http_samples` | raw DNS/HTTP probe results — retained `retentionDnsHttpDays` |
| `speed_tests` | every speed test: down/up bps, loaded/idle latency, bufferbloat grade, bytes moved — kept forever |
| `events` | detected problems: kind, severity, classification, start/end, summary, detail JSON — kept forever |
| `event_evidence` | mtr traces and ping windows per event (FK, cascade delete) — kept forever |
| `ping_rollups_hourly`, `dns_rollups_hourly`, `http_rollups_hourly` | permanent hourly aggregates of the raw samples |
| `data_usage_hourly` | measurement bytes by hour/category |
| `schema_migrations` | applied migration versions |

Raw samples age out; rollups, events, evidence, and speed tests are permanent. Disk
footprint stays well under 500 MB.
