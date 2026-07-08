# The Dashboard

The Dashboard is Trapline's home screen: the live picture of your connection right now,
plus the recent past.

## The status banner

The big banner at the top answers the only question that matters most of the time:

- **Connection is up** (green) — everything is being reached normally.
- **Degraded** (amber) — the connection works but something is off (losing some traffic,
  or unusually slow to respond).
- **DOWN** (red) — nothing on the internet can be reached.

It also shows how long the connection has been in that state, and — when something is
wrong — a plain-language hint about *where* the problem is, such as "your router is fine;
the problem is on the ISP side" or "your own router is not responding; check your home
equipment first."

## The six tiles

Hover over any tile for an explanation. In short:

- **Uptime 24 h / 7 d / 30 d** — the percentage of time your connection was working, with
  the number of outages underneath. 100% is the goal; anything below about 99.9% over a
  month means real, noticeable interruptions.
- **Packet loss (24 h)** — the percentage of Trapline's test messages that never came
  back. Zero is normal. Even 1–2% makes video calls stutter.
- **Latency p50 / p95** — how long a round trip to the internet takes, in milliseconds.
  p50 is the typical trip; p95 is the bad moments. Under ~30 ms feels instant; over
  ~120 ms is noticeable in calls and games.
- **Quality score** — everything above combined into a single 1-to-5 score using a
  standard telephone-industry formula (it predicts how a voice call would sound on your
  line). 4+ is good; below 3 means calls sound rough.

## The live latency chart

A live graph of response times, updated within a couple of seconds. Lost probes appear as
red markers along the bottom. You can switch which target you're viewing — your **router**,
the **ISP's first hop** (the ISP equipment your line connects to), or an **internet
anchor** (a big, always-on public service) — and change the time window from 15 minutes up
to 24 hours, or pick any custom range.

## Why those three targets?

This trio is what lets Trapline assign blame honestly:

- If the **router** stops answering, the problem is inside your home.
- If the router is fine but the **ISP hop** is dead, the ISP's network failed.
- If both are fine but the **anchors** are unreachable, the trouble is beyond your ISP,
  somewhere upstream on the wider internet.

Each target has its own card showing its latest response time and recent loss, with a
small live graph.

## Speed history

Every automatic and manual speed test from the last 30 days, plotted against the plan
speed you entered in Settings — so a slow week is visible at a glance.

## Recent events

The last problems Trapline detected — outages, loss episodes, latency spikes — each
labeled with its cause (`lan` = your home, `isp` = the provider, `upstream` = beyond the
provider). Click one for details, including the raw evidence Trapline captured while it
was happening.

## Monitoring modes

The mode switcher controls how intensively Trapline probes:

- **Eco** — one check every 30 seconds, one speed test nightly. For homes with small data
  caps (roughly 2–4 GB/month of measurement traffic).
- **Normal** (recommended) — a check every 5 seconds, four speed tests a day. Unnoticeable
  on a 100 Mbps line.
- **Full Capture** — for when things are broken *right now*: checks every second and a
  speed test every two hours, capturing the richest possible evidence. To make sure you
  don't burn data by accident, it always switches itself back to Normal after a timer
  (6 hours by default — you can choose).

When Trapline notices repeated trouble, it will *suggest* Full Capture with a banner — it
never switches modes on its own.
