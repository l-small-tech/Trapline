# Getting started

## What you need

- **A computer that stays on**, connected to your router with a cable if possible. A small
  mini-PC or a Raspberry-Pi-class board is ideal; an old laptop works fine. Trapline is
  very light — it needs almost no processing power and well under 500 MB of disk.
- **Linux** on that computer, with **Node.js 22 or newer** (24 recommended) installed.
- The standard `ping` command (already present on virtually every Linux system) and,
  ideally, `mtr` (`sudo apt install mtr-tiny`), which lets Trapline record *where* on the
  route your traffic is being lost.

Why a cable? Trapline measures your internet line. If the monitoring computer is on WiFi,
some hiccups it records will really be WiFi hiccups. Trapline can still tell "my home
network" apart from "the ISP" either way, but a wired connection gives the cleanest
evidence.

## Install and start

Open a terminal in the Trapline folder and run these three commands:

```bash
./trapline build     # installs everything and builds the app (takes a few minutes)
./trapline setup     # registers Trapline as a background service that survives reboots
./trapline start     # starts monitoring
```

Then open **http://127.0.0.1:8731/trapline/** in a web browser on that computer. You
should see the Dashboard with a green "Connection is up" banner within a few seconds.

Prefer Docker? See the [deployment guide](../technical/deployment.md) — the important
detail is that Trapline needs *host networking* to see your real router.

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

Useful terminal commands, should you ever need them:

```bash
./trapline status    # is it running? quick health summary
./trapline stop      # stop monitoring
./trapline restart   # restart
./trapline logs      # watch the service logs
```
