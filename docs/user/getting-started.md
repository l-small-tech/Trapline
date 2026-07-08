# Getting started

## What you need

- **A computer that stays on**, connected to your router **with an Ethernet cable** (this
  matters — see below). A small mini-PC or a Raspberry-Pi-class board is ideal; an old
  laptop works fine. Trapline is very light — it needs almost no processing power and
  well under 500 MB of disk.
- **Windows, macOS, or Linux.** The easiest way to run Trapline is the standalone
  download below — a single file, nothing to install. (Running from source or as a
  Linux service is covered [further down](#advanced-run-as-a-linux-service-or-from-source).)
- Optionally, the `mtr` tool, which lets Trapline record *where* on the route your
  traffic is being lost: `brew install mtr` on macOS, `sudo apt install mtr-tiny` on
  Linux. There's no mtr for Windows — Trapline works fine without it, you just get less
  detailed route evidence.

**Why the cable is important:** Trapline measures your internet line, and it can only see
that line *through* the computer's own connection to the router. WiFi has hiccups of its
own — interference from walls, microwaves, neighbours' networks — and from Trapline's
side of the wall those look identical to internet problems. A report gathered over WiFi
will overstate your problems, and your ISP would be right to question it. On a cable,
every recorded problem really happened on the line.

Trapline checks this for you: if it detects it's running over WiFi, or that the
computer's network port is slower than the internet plan you pay for (an old 100 Mbps
port can't measure a 250 Mbps plan), a warning banner appears on the Dashboard and
Settings pages explaining what to do. No banner means you're good.

## Download and run

Grab the file for your system from the
[latest release](https://github.com/l-small-tech/Trapline/releases/latest). It's one
self-contained program (~90–130 MB, because it includes everything it needs) — no
installer, no Docker, no Node.js.

| Your computer | Download the file ending in |
|---|---|
| Windows (Intel/AMD) | `-windows-x64.exe` |
| Mac with Apple Silicon (M1 or newer) | `-macos-arm64` |
| Mac with Intel CPU | `-macos-x64` |
| Linux (Intel/AMD) | `-linux-x64` |
| Linux (ARM, e.g. Raspberry Pi 4/5, 64-bit) | `-linux-arm64` |

When you run it, your web browser opens the Dashboard at
**http://127.0.0.1:8731/trapline/** automatically. Monitoring runs for as long as the
program is running — leave it going, and press **Ctrl+C** in its window when you want to
stop.

### Windows

Double-click the `.exe`. Windows SmartScreen will warn about an "unknown publisher" —
the file is safe but unsigned (code-signing certificates cost money this free project
doesn't spend). Click **More info → Run anyway**. A console window opens; **keep it
open** — closing it stops monitoring.

Your measurements are stored in `%LOCALAPPDATA%\Trapline`.

### macOS

macOS quarantines downloaded programs that aren't notarized by Apple. Open Terminal and
run this once (adjust the filename to the one you downloaded):

```bash
chmod +x ~/Downloads/trapline-*-macos-*
xattr -d com.apple.quarantine ~/Downloads/trapline-*-macos-*
~/Downloads/trapline-*-macos-arm64    # or -x64 on an Intel Mac
```

Your measurements are stored in `~/Library/Application Support/Trapline`. Optional:
`brew install mtr` for route evidence.

### Linux

```bash
chmod +x ./trapline-*-linux-x64
./trapline-*-linux-x64
```

Your measurements are stored in `~/.local/share/trapline`. Optional:
`sudo apt install mtr-tiny` for route evidence.

### Worried about running a downloaded program?

Good instinct. Every release file comes with a checksum list (`SHA256SUMS.txt`) and a
cryptographic attestation proving it was built by GitHub's own servers from Trapline's
published source code — see [the FAQ](faq.md#windows-or-macos-warns-me-about-the-downloaded-program-is-it-safe)
for how to verify both.

## First-run setup (two minutes)

Go to the **Settings** page and fill in **Your internet plan**:

- Your ISP's name.
- The download and upload speeds you pay for (from your bill or the ISP's website).
- What you pay per month (optional).

This is what turns "measured 61 Mbps" into "measured 61 Mbps of the 250 Mbps you pay
for" in your reports. That's it — everything else has sensible defaults. Trapline
automatically finds your router and your ISP's equipment and starts watching.

## Day-to-day

You don't need to do anything. Trapline runs by itself, checks the connection every few
seconds, runs a handful of speed tests a day at random times, and records everything.
Glance at the [Dashboard](dashboard.md) whenever you're curious, and when you're ready to
talk to your ISP, export a report from the [Reports](reports.md) page.

The one thing to remember with the standalone program: it monitors only while it's
running, so leave it running. If the computer reboots, start it again (or set it to
start automatically — see the [deployment guide](../technical/deployment.md#standalone-binary)
for per-OS auto-start recipes). Time when the monitor was off is never counted against
your ISP — it just shows as a gap in coverage.

## Advanced: run as a Linux service or from source

If you're setting up a dedicated always-on Linux box, you can instead run Trapline from
a clone of the source code as a background service that survives reboots. You'll need
**Node.js 24 or newer** installed. Open a terminal in the Trapline folder and run:

```bash
./trapline build     # installs everything and builds the app (takes a few minutes)
./trapline setup     # registers Trapline as a background service that survives reboots
./trapline start     # starts monitoring
```

Then open **http://127.0.0.1:8731/trapline/** in a web browser on that computer. You
should see the Dashboard with a green "Connection is up" banner within a few seconds.

Useful terminal commands, should you ever need them:

```bash
./trapline status    # is it running? quick health summary
./trapline stop      # stop monitoring
./trapline restart   # restart
./trapline logs      # watch the service logs
```

Prefer Docker? See the [deployment guide](../technical/deployment.md) — the important
detail is that Trapline needs *host networking* to see your real router.
