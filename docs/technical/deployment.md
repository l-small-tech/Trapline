# Deployment

Trapline is designed to run 24/7 on a small always-on Linux box on the network you want
to measure. Three supported shapes: the launcher + systemd (recommended), Docker, and a
plain dev process.

## Requirements

- Linux, Node.js ≥ 22 (24 recommended).
- `ping` (iputils — standard everywhere).
- `mtr` recommended (`sudo apt install mtr-tiny`) for route evidence; Trapline runs a
  raw-socket self-test at startup and the UI warns if mtr is unavailable.
- A wired connection to the router gives the cleanest evidence (WiFi hiccups otherwise
  appear as `lan` noise).

## Launcher + systemd (recommended)

```bash
./trapline build     # npm install, typecheck, tests, web build
./trapline setup     # render + install a systemd *user* unit, enable lingering
./trapline start
```

`setup` renders `deploy/trapline.service.tmpl` (substituting the repo root and node
path) into `~/.config/systemd/user/trapline.service`, enables it, and runs
`loginctl enable-linger` so the service starts at boot without a login. Everything is
user-level; no root required. Other commands: `status`, `stop`, `restart`, `logs`,
`mode eco|normal|full`.

The server binds `127.0.0.1:8731` and serves the UI itself at
`http://127.0.0.1:8731/trapline/` — no web server needed on the box.

## Serving on the LAN with nginx

Keep Trapline bound to loopback and put nginx in front (see [security](security.md)
before exposing it):

- `deploy/nginx-trapline.conf` contains the three location blocks: static SPA from
  `web/dist`, API proxy to `127.0.0.1:8731`, and a buffering-off block for the SSE live
  stream. Replace `/opt/trapline` in it with your clone path — `./trapline setup` prints
  the exact `include` and `setfacl` commands for your machine.

## Docker

```bash
docker compose up -d --build
```

Two non-negotiable details, both encoded in `docker-compose.yml`:

- **`network_mode: host`** — on a bridge network the discovered "gateway" would be the
  Docker bridge, and every outage would be misclassified as `lan`. The monitor must see
  the machine's real default gateway and the ISP's first hop.
- **`cap_add: NET_RAW`** — ping and mtr need raw sockets.

The container still binds `127.0.0.1:8731` (`TRAPLINE_HOST=127.0.0.1`); expose it on the
LAN through nginx, not by widening the bind address. Data persists in the
`trapline-data` volume (`TRAPLINE_DATA_DIR=/data`).

### Self-updating deployment

For a hands-off box, run the container from a git clone and add a cron entry for
`deploy/auto-update.sh`:

```
30 4 * * * /path/to/trapline/deploy/auto-update.sh >> "$HOME/trapline-autoupdate.log" 2>&1
```

The script fetches `origin/main`; if the branch hasn't moved it exits quietly, otherwise
it hard-resets the clone, rebuilds, restarts the container, and waits for health. It is
idempotent and safe to run by hand. **Warning:** it deploys whatever is on `origin/main`
— only point it at a repository whose main branch you trust to be deployable.

## Development

```bash
npm install
npm run dev            # server (:8732) + Vite dev server (:5173) together
npm run dev:server     # API only, tsx watch, 127.0.0.1:8731
npm run dev:web        # UI only, Vite with API proxy
npm test               # unit tests
npm run typecheck
```

## Environment

See the [configuration reference](configuration.md) for `TRAPLINE_DATA_DIR`,
`TRAPLINE_HOST`, `TRAPLINE_PORT`, `LOG_LEVEL`, and `TRAPLINE_DEBUG`.

## Backup & restore

All state is the single SQLite database in the data directory (`data/trapline.db` plus
its `-wal`/`-shm` companions). To back up safely while running, use
`sqlite3 data/trapline.db ".backup backup.db"`; to move an installation, stop the
service and copy the data directory.
