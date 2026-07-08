# API reference

All routes are served under the prefix **`/trapline/api`** (e.g.
`GET http://127.0.0.1:8731/trapline/api/status`). Requests and responses are JSON unless
noted. There is **no authentication** — anything that can reach the port has full access;
see [security](security.md). Response shapes are the DTOs in `shared/types.ts`;
implementations in `server/src/api/routes.ts`.

Time parameters (`from`, `to`) are Unix epoch **milliseconds**; ranges default to the
last 24 hours when omitted.

## Health & status

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness: `{ok, version, uptimeSec, sseClients}` |
| GET | `/status` | Full monitor status: state, mode, targets, mtr availability, and the machine's own link (`link`: interface, wired/WiFi, negotiated Mbps — `LinkInfo` in `shared/types.ts`; nulls mean "couldn't determine") |
| GET | `/summary?from&to` | `SummaryStats` for a range: uptime, coverage, loss, latency percentiles, MOS, speed averages |

## Samples & rollups

| Method | Path | Description |
|---|---|---|
| GET | `/samples/ping?from&to&maxPoints&targetId` | Raw ping series, min/max-decimated per target (`maxPoints` clamped 100–20 000) |
| GET | `/samples/dns?from&to` | Raw DNS probe samples |
| GET | `/samples/http?from&to` | Raw HTTP probe samples |
| GET | `/rollups/ping?from&to&targetId` | Hourly ping rollups (for long ranges) |

## Speed tests

| Method | Path | Description |
|---|---|---|
| GET | `/speedtests?from&to` | Stored results |
| POST | `/speedtests` | Start a manual test; `202 {started}` or `409` if one is running. Progress streams over SSE (`speedtest` events). |

## Events

| Method | Path | Description |
|---|---|---|
| GET | `/events?from&to&kind` | Events in range, optionally filtered by kind |
| GET | `/events/recent` | Last 50 events |
| GET | `/events/:id` | One event including its stored evidence (ping window, mtr traces) |

## Settings, mode, targets

| Method | Path | Description |
|---|---|---|
| GET | `/settings` | Current settings (defaults merged) |
| PUT | `/settings` | Partial update. Validated server-side: unknown keys rejected, speedtest URLs must be http(s), numeric bounds enforced (see [configuration](configuration.md)). `mode` in the body is ignored. |
| POST | `/mode` | `{mode: 'eco'\|'normal'\|'full', revertAfterMs?}` — switch mode via the scheduler |
| POST | `/suggestion/dismiss` | Dismiss the Full-Capture suggestion banner |
| GET | `/targets` | All probe targets |
| POST | `/targets` | `{host, label?}` — add a custom target (host validated: hostname/IP characters only, no leading dash) |
| PATCH | `/targets/:id` | `{enabled?, host?, label?}` |
| DELETE | `/targets/:id` | Remove a target (custom targets only) |
| POST | `/targets/rediscover` | Re-run gateway + ISP-hop discovery |

## Tools (on-demand diagnostics)

| Method | Path | Description |
|---|---|---|
| POST | `/tools/ping` | `{host, count?}` — one-shot ping burst (count clamped 1–20) |
| POST | `/tools/mtr` | `{host}` — route trace; `502` if mtr unavailable |
| POST | `/tools/dns-bench` | Benchmark system resolver vs 1.1.1.1 / 8.8.8.8 / 9.9.9.9 |
| POST | `/tools/health-check` | ~10 s all-in-one check → verdict good/degraded/bad |

Host parameters are validated against `^[a-zA-Z0-9]([a-zA-Z0-9.:-]{0,252}[a-zA-Z0-9])?$`
and passed to `ping`/`mtr` as argv arrays (never a shell).

## Reports

| Method | Path | Description |
|---|---|---|
| GET | `/reports?from&to&format=html\|csv\|json` | Generate a report. `html` = self-contained evidence report; `csv` = events + daily summaries + speed tests; `json` = full payload incl. evidence. |

## Live stream (SSE)

`GET /live` — a Server-Sent Events stream. Event types:

| Event | Payload |
|---|---|
| `status` | Monitor status (sent immediately on connect, then on change) |
| `samples` | Batched new probe samples (dashboard updates within ~2 s) |
| `event` | A detection event opened/closed |
| `speedtest` | Live speed-test progress (phase, current Mbps) |
| `suggestion` | Full-Capture suggestion raised |

Keepalive comments every 15 s; `EventSource` auto-reconnect is relied upon client-side.
