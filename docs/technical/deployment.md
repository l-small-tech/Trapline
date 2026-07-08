# Deployment

Trapline is designed to run 24/7 on a small always-on box on the network you want to
measure. Four supported shapes: the standalone binary (any OS), the launcher + systemd
(recommended for a dedicated Linux box), Docker, and a plain dev process.

## Requirements

- **Standalone binary:** Windows, macOS, or Linux — no other software needed.
  **From source or Docker:** Node.js ≥ 24 (the database uses the built-in `node:sqlite`,
  so there is no native module and no compile toolchain to install).
- The system `ping` (present on every supported OS; Trapline drives it per-platform —
  see [architecture](architecture.md#platform-support)).
- `mtr` recommended (`sudo apt install mtr-tiny` on Linux, `brew install mtr` on macOS;
  not available on Windows) for route evidence; Trapline runs a raw-socket self-test at
  startup and the UI warns if mtr is unavailable. Without it, ISP-hop discovery falls
  back to `traceroute`/`tracert` and route evidence is disabled.
- **A wired (Ethernet) connection to the router.** WiFi interference is otherwise
  recorded as if it were line trouble, which undermines the evidence. Trapline detects a
  WiFi vantage point (and wired ports negotiated below the plan speed) and warns in the
  UI; detection is best-effort (`/sys` on Linux, `networksetup`/`ifconfig` on macOS,
  `Get-NetAdapter` on Windows), so inside VMs it may report unknown — the wired
  requirement stands either way.

## Standalone binary

Releases ship single-file executables built with Node's Single Executable Application
(SEA) support: the server bundle, the web UI, and the Node runtime are embedded in one
~90–130 MB binary per target (`windows-x64`, `macos-arm64`, `macos-x64`, `linux-x64`,
`linux-arm64`). Built by GitHub Actions from the pushed tag — see `RELEASING.md` at the
repo root for the pipeline, and [security](security.md#release-integrity) for
checksums/attestations.

Run it and the browser opens `http://127.0.0.1:8731/trapline/`; Ctrl+C stops it.
Per-OS first-run notes (SmartScreen, Gatekeeper quarantine) are in the
[user guide](../user/getting-started.md#download-and-run).

The binary accepts `--port <n>`, `--host <addr>`, `--data-dir <dir>`, `--no-browser`,
`--version`, `--help`, each with an environment equivalent — see
[configuration](configuration.md). Data directory defaults differ from source installs:
`%LOCALAPPDATA%\Trapline` (Windows), `~/Library/Application Support/Trapline` (macOS),
`$XDG_DATA_HOME/trapline` or `~/.local/share/trapline` (Linux).

### Auto-start on boot/login

The binary monitors only while running, so for an always-on vantage point register it
with the OS. All three recipes use `--no-browser` so a login doesn't spawn a tab.

**Windows — Task Scheduler:** create a task triggered **At log on** with the action
`C:\path\to\trapline-vX.Y.Z-windows-x64.exe --no-browser`. In the task settings,
disable "Stop the task if it runs longer than". A console window will be present while
it runs (it is the process).

**macOS — launchd LaunchAgent:** save as
`~/Library/LaunchAgents/tech.l-small.trapline.plist`, then
`launchctl load ~/Library/LaunchAgents/tech.l-small.trapline.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>tech.l-small.trapline</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/you/Applications/trapline-vX.Y.Z-macos-arm64</string>
    <string>--no-browser</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

**Linux — systemd user unit:** save as `~/.config/systemd/user/trapline.service`, then
`systemctl --user enable --now trapline` (and `loginctl enable-linger $USER` so it
starts at boot without a login):

```ini
[Unit]
Description=Trapline ISP monitor
After=network-online.target

[Service]
ExecStart=%h/bin/trapline-vX.Y.Z-linux-x64 --no-browser
Restart=on-failure

[Install]
WantedBy=default.target
```

When upgrading, replace the binary (or repoint the unit/plist/task) — the data
directory is independent of the executable, so measurements carry over.

## Launcher + systemd (recommended for a dedicated Linux box)

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

See the [configuration reference](configuration.md) for the CLI flags and for
`TRAPLINE_DATA_DIR`, `TRAPLINE_HOST`, `TRAPLINE_PORT`, `TRAPLINE_NO_BROWSER`,
`LOG_LEVEL`, and `TRAPLINE_DEBUG`.

## Backup & restore

All state is the single SQLite database in the data directory (`trapline.db` plus its
`-wal`/`-shm` companions; see [configuration](configuration.md) for the per-platform
default locations). To back up safely while running, use
`sqlite3 <data-dir>/trapline.db ".backup backup.db"`; to move an installation — even
across install methods or operating systems — stop Trapline and copy the data
directory.
