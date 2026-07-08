# Settings, explained

Everything on the Settings page, card by card. Each card has its own **Save** button.

## Your internet plan

- **ISP name** — appears in your reports ("measured against the plan sold by …").
- **Download / Upload speed (Mbps)** — the speeds you pay for, from your bill or the
  ISP's website. Trapline compares every speed test against these; without them, speed
  results are shown but can't be judged against your plan.
- **Price per month** — optional; gives reports a "what you pay" context line.
- **Slow-speed alert threshold** — how far below the advertised speed a test must fall
  before Trapline records a *speed degradation* event. The default (0.5) flags tests
  below half the advertised speed.
- **High-latency alert threshold (ms)** — if the typical response time stays above this
  for a sustained period, Trapline records a *high latency* event. Default 120 ms; set to
  0 to turn this off.

## Probe targets

The list of things Trapline pings around the clock:

- **Your router** and the **ISP's first hop** are discovered automatically. You can
  disable them (untick), but not remove them. If you replace your router or the automatic
  detection looks wrong, click **Re-discover router & ISP hop**.
- **Internet anchors** (Cloudflare and Google DNS) are the "rest of the internet"
  reference points.
- **Custom targets** — add anything you care about (your workplace VPN, a game server) by
  entering its address and an optional label. Custom targets can be removed at any time.

More targets = slightly more measurement data used, but a richer picture.

## Appearance & data retention

- **Theme** — dark or light. Stored in your browser only.
- **Keep raw probe records for (days)** — how long the second-by-second raw measurements
  are kept (default 14 days, allowed 3–90). Older raw records are condensed into
  permanent hourly summaries, so long-term statistics and reports lose nothing — this
  setting only controls how far back you can zoom into second-level detail. Outage
  events, their evidence, and speed tests are **always kept forever**.

## What's *not* here

The monitoring **mode** (Eco / Normal / Full Capture) is switched on the Dashboard, where
you can see its effect live.

This page also warns you about setup problems that weaken your evidence:

- **Running over WiFi** — connect the computer to the router with an Ethernet cable,
  then click **Re-discover router & ISP hop** (WiFi interference otherwise gets recorded
  as if it were the ISP's fault).
- **Network port slower than your plan** — a computer with an old 100 Mbps port can't
  measure a faster plan; its speed tests are capped by the port, not the ISP.
- **`mtr` not installed** — without it, Trapline can't record the hop-by-hop route
  evidence during problems. Fix with `sudo apt install mtr-tiny`.
