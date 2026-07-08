# Getting started

## What you need

- **A computer that stays on**, connected to your router **with an Ethernet cable** (this
  matters — see below). A small mini-PC or a Raspberry-Pi-class board is ideal; an old
  laptop works fine. Trapline is very light — it needs almost no processing power and
  well under 500 MB of disk.
- **Linux** on that computer, with **Node.js 22 or newer** (24 recommended) installed.
- The standard `ping` command (already present on virtually every Linux system) and,
  ideally, `mtr` (`sudo apt install mtr-tiny`), which lets Trapline record *where* on the
  route your traffic is being lost.

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
