# Security

Trapline is designed to run **on a trusted private network**, monitored and administered
by the household that runs it. This document states the threat model explicitly, what the
code does and doesn't defend against, and how to expose it safely.

## Threat model & trust boundary

**The trust boundary is network reachability.** The API has **no authentication, no
CORS policy, and no rate limiting** — deliberately. Anything that can open a TCP
connection to the Trapline port has full control: read all measurements, change
settings, add probe targets, and trigger diagnostics. The design compensates by not
being reachable:

- The server binds **`127.0.0.1:8731`** by default (`TRAPLINE_HOST` in
  `server/src/config.ts`), and the Docker compose file keeps that bind even with host
  networking.
- LAN access is intended to go through a reverse proxy **you** configure (see below).

**Consequences of API access** (i.e., what an attacker on the wrong side of the boundary
gets):

- The Tools and targets endpoints will `ping`/`mtr` **arbitrary hosts, including
  RFC1918/internal addresses** — that's their purpose ("is it me or the ISP?"), but it
  means API access ⇒ the box can be used as a network-probing vantage point.
- `PUT /settings` can repoint the speed-test endpoints at any http(s) URL, causing the
  server to fetch/POST large transfers there on schedule.
- Unlimited diagnostics (speed tests, ping bursts, DNS benches) can be triggered,
  consuming bandwidth and spawning (bounded, timeout-killed) processes.

None of this is remote code execution, but it is full control of the monitor. **Never
bind to `0.0.0.0` on a network you don't fully trust**, and don't port-forward Trapline
to the internet.

## Exposing the UI on your LAN, safely

Keep the bind on loopback and proxy through nginx (`deploy/nginx-trapline.conf`). If
anyone untrusted can reach your LAN (shared housing, guest WiFi on the same segment),
add basic auth to the proxy:

```nginx
location /trapline/ {
    auth_basic           "Trapline";
    auth_basic_user_file /etc/nginx/.htpasswd-trapline;   # htpasswd -c <file> <user>
    # ... existing alias/proxy directives ...
}
```

(Apply the same two lines to the `/trapline/api/` and `/trapline/api/live` blocks.)

## What is hardened in the code

For auditors — these are the deliberate defenses, with locations:

- **No shell, ever.** All external commands (`ping`, `mtr`, `ip`) are spawned with
  argv arrays (`spawn`/`execFile`); there is no `exec`, no `shell: true`
  (`server/src/api/routes.ts`, `server/src/probes/*.ts`).
- **Host input validation.** Every user-supplied host (Tools, custom targets) must match
  `^[a-zA-Z0-9]([a-zA-Z0-9.:-]{0,252}[a-zA-Z0-9])?$` — no whitespace or shell
  metacharacters, and the mandatory leading alphanumeric also blocks argument injection
  (`-oFoo=...` can't pass). Counts/cycles are numerically clamped.
- **Settings validation.** `PUT /settings` rejects unknown keys, type-checks every
  field, bounds all numerics, and requires the speed-test endpoints to be http(s) URLs
  (`mergeSettings` in `server/src/api/routes.ts`).
- **Parameterized SQL only.** Every statement in `server/src/db/repo.ts` uses `?`
  placeholders; no user data is interpolated into SQL text.
- **Escaped report output.** All strings interpolated into the generated HTML report
  pass through `esc()` (escaping `& < > " '` — `server/src/api/reportHtml.ts`); CSV
  export neutralizes leading spreadsheet-formula triggers (`=`, `+`, `-`, `@`) on text
  fields (`server/src/api/reports.ts`).
- **Confined filesystem writes.** The server writes only to the SQLite database under
  `TRAPLINE_DATA_DIR`; no request input influences any file path. Static file serving is
  confined to `web/dist` via `@fastify/static`.
- **Bounded child processes.** Ping/mtr children are timeout-killed (SIGKILL) and
  rate-limited; the long-lived ping probes restart with backoff.

## Outbound traffic (what Trapline talks to)

By default: ICMP to the local gateway, the ISP first hop, `1.1.1.1` and `8.8.8.8`; DNS
lookups of `www.google.com`, `www.northwestel.net`, `example.com` via the system
resolver (plus `1.1.1.1`/`8.8.8.8`/`9.9.9.9` when you run the DNS bench); HTTP to
`connectivitycheck.gstatic.com` and `www.cloudflare.com`; speed tests to
`speed.cloudflare.com` (configurable). **No telemetry, no update checks, no accounts** —
measurement data never leaves the machine unless you export it.

## Privileges

- The systemd deployment is a **user** unit; nothing runs as root. `ping` uses the
  standard setuid/ICMP-socket mechanisms of the distro; `mtr-tiny` ships setuid or uses
  capabilities.
- Docker needs only `NET_RAW` added (for ping/mtr raw sockets); no `--privileged`.
- If you use `deploy/auto-update.sh`, understand it deploys whatever is on
  `origin/main` of its clone — treat push access to that branch as deploy access.

## Reporting a vulnerability

Please open a GitHub security advisory (or a private report to the maintainer) rather
than a public issue, and include reproduction steps. Trapline is small on purpose —
audits and hardening patches are very welcome.
