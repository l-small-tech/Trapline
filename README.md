# Trapline

**Community ISP service-quality monitor.** Trapline runs quietly on a computer in your home,
checks your internet connection around the clock — like walking a trapline — and turns what it
finds into evidence-grade reports you can put in front of your ISP: exact outage timestamps,
durations, latency/loss statistics, measured speed vs what you pay for, and a fault
classification that distinguishes *"my WiFi was broken"* from *"the ISP's network was down."*

Built for the Yukon and Northwestel fiber customers, useful anywhere.

## Why

When your internet drops for the fourth time in a week, the ISP asks "have you tried rebooting
your router?" and the conversation goes nowhere. Trapline replaces anecdotes with data:

- **"The connection dropped 9 times in March for a total of 3 h 12 m"** — with a table of exact
  UTC timestamps for every incident.
- **"During each outage my router stayed reachable while your first hop did not"** — so the
  it's-your-equipment deflection doesn't fly.
- **"Speed tests averaged 61% of the advertised 250 Mbps"** — measured on a schedule, not
  cherry-picked.

## Quick start

Requirements: Linux, Node.js 22+ (24 recommended), `ping` (standard), `mtr` (recommended:
`sudo apt install mtr-tiny`).

```bash
./trapline build     # install deps, typecheck, run tests, build the web UI
./trapline setup     # install + enable the systemd user service (24/7, survives reboots)
./trapline start     # start monitoring
```

Open **http://127.0.0.1:8731/trapline/** — no web-server configuration needed. To serve it on
port 80 behind nginx, `./trapline setup` prints the three lines to add (see
`deploy/nginx-trapline.conf`).

Other commands: `./trapline status | stop | restart | logs | mode eco|normal|full`.

## What it measures

| Probe | How | Cadence (Normal mode) |
|---|---|---|
| Reachability + latency | continuous ICMP ping to your router, the ISP's first hop (auto-discovered), and two public anchors (1.1.1.1, 8.8.8.8) | every 5 s per target |
| DNS health | timed lookups through the machine's own resolver | every 60 s |
| Web reachability | small HTTP fetches of always-on endpoints, with time-to-first-byte | every 60 s |
| Throughput + bufferbloat | built-in multi-stream HTTP speed test against Cloudflare's public speed endpoints — no proprietary binaries | 4×/day at randomized times |
| Route evidence | `mtr` trace captured automatically when a problem starts | on anomaly |

### Monitoring modes

- **Eco** — minimal probing, ~2–4 GB/month. For homes with data caps.
- **Normal** (default) — full probing, a handful of speed tests a day. Unnoticeable on a
  100 Mbps line.
- **Full Capture** — for when things are broken *right now*: 1 s probes, speed tests every 2 h,
  aggressive evidence capture. Always auto-reverts to Normal after a timer (default 6 h).
  Trapline suggests (never forces) this mode when it detects trouble.

The **Data usage** page shows exactly how much data monitoring has used (lifetime / year /
month / day) and projects monthly usage per mode from your actual measurements.

## How outages are detected and blamed

An **outage** opens when 3 consecutive probes are lost on *every* internet-side target
simultaneously, and closes after 3 consecutive replies — timestamps are backdated/set to the
first lost/first successful probe, so durations are exact to within one probe interval.

Every event is **classified**:

| Observation during the event | Classification |
|---|---|
| Your router also unreachable | `lan` — problem inside the home; **excluded from ISP claims** |
| Router fine, ISP first hop dead | `isp` — the network you pay for failed |
| Router and ISP hop fine, only far targets dead | `upstream` — trouble beyond the ISP |

Honesty rules that keep the reports credible:

- Time when the monitor itself wasn't running is **excluded** from uptime math and disclosed as
  "coverage %" — downtime is never inferred from gaps in monitoring.
- Home-network (`lan`) events are labeled as such, front and center.
- Every event stores its raw evidence: the surrounding ping samples and an `mtr` route trace
  showing exactly where packets died.
- The methodology (thresholds, formulas, endpoints) is printed inside every report, and this
  codebase is small and MIT-licensed — anyone, including the ISP, can audit it.

## Reports

On the **Reports** page pick a date range and export:

- **HTML evidence report** — self-contained single file (charts inlined as SVG, zero external
  assets), print-to-PDF ready, with summary stats, the outage table, speed-vs-plan chart, and a
  methodology appendix.
- **CSV** — events, daily summaries, and speed tests for spreadsheets.
- **JSON** — the full structured payload, including per-event evidence, for your own analysis.

Quality score uses the simplified ITU-T G.107 E-model (MOS): latency, jitter, and loss combined
into the familiar 1–5 call-quality scale. The exact formula is in the report appendix and
`server/src/util/mos.ts`.

## Architecture

```
trapline/
├── trapline                  bash launcher (build/setup/start/stop/status/logs/mode)
├── deploy/                   nginx location config + systemd unit template
├── shared/types.ts           DTOs shared by server and UI
├── server/  (Fastify 5, TypeScript, run via tsx)
│   └── src/
│       ├── probes/           ping (long-lived child process), dns, http, mtr, discovery
│       ├── monitor/          scheduler (modes/timers), detector (outage state machines),
│       │                     evidence capture, hourly rollups + retention, usage ledger
│       ├── speedtest/        multi-stream HTTP engine + loaded-latency (bufferbloat)
│       ├── api/              REST routes, SSE live stream, report generation (HTML/CSV/JSON)
│       └── db/               better-sqlite3 (WAL), versioned migrations, all SQL in repo.ts
└── web/     (React 18 + Vite + uPlot)
    └── src/pages/            Dashboard, Reports, Tools, Usage, Settings
```

- **Storage:** single SQLite file at `data/trapline.db`. Raw ping samples are kept 14 days
  (configurable) then condensed into permanent hourly rollups; events, evidence, and speed
  tests are kept forever. Disk footprint stays well under 500 MB.
- **Live updates:** Server-Sent Events (`/trapline/api/live`) — the dashboard updates within
  2 s of any probe.
- **Standalone:** the Node server serves the built UI itself; nginx is optional.

## Tools page

On-demand checks for "is it me or the ISP, right now?": one-click health check, speed test with
live progress, DNS resolver benchmark (system vs 1.1.1.1 / 8.8.8.8 / 9.9.9.9), ping and mtr to
any host.

## Development

```bash
npm install
npm run dev:server        # API on 127.0.0.1:8731 (tsx watch)
npm run dev:web           # Vite dev server on :5173 with API proxy
npm test                  # unit tests (detector state machines, ping parser, stats)
npm run typecheck
```

The detection thresholds live in `server/src/monitor/detector.ts`; probe cadences per mode in
`server/src/config.ts`. Both are deliberately boring to read — that's the point of an evidence
tool.

## License

MIT — see [LICENSE](LICENSE). Contributions welcome, especially from fellow northerners.
