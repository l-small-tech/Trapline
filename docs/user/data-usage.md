# Data usage — what monitoring costs you

Monitoring the connection means using the connection. Trapline is designed to be honest
about that cost and to keep it small — and if you have a data cap, to keep you safely
under it.

## Where the data goes

The constant pings, name lookups, and web checks are tiny — a few megabytes a day, less
than a couple of songs. Nearly all of Trapline's data use comes from **speed tests**,
which have to move real data to measure real speed: typically 100–300 MB per test.

## The Data usage page

- **Lifetime** and **this month** — exactly how much data monitoring has used, measured
  (not estimated) from Trapline's own records.
- **Projected per month** — what each monitoring mode would use over a month, projected
  from *your* line's actual measurements: Eco, Normal, and Full Capture each get a
  figure, so you can choose a mode with your data cap in front of you.
- **Usage over time** — a chart, viewable by hour, day, month, or year, broken down by
  what used the data (speed tests versus the small background probes).

## Staying under a data cap

- Switch to **Eco** mode on the Dashboard: probes every 30 seconds and a single nightly
  speed test — roughly 2–4 GB per month, while still catching every outage. (Outage
  timing is a little less precise: with checks every 30 seconds, a dropout's start time
  is known to within 30 seconds rather than 5.)
- Be sparing with manual speed tests, and remember **Full Capture** runs a speed test
  every two hours — it's deliberately data-hungry. It always reverts to your normal mode
  automatically after its timer, so it can't quietly eat your cap for a week.
