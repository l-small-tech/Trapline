# Reports — turning measurements into evidence

The Reports page is where Trapline earns its keep: pick a period, review what happened,
and export a report you can send to your ISP.

## Picking a period

Use the presets (last 24 hours / 7 / 30 / 90 days) or set exact dates — for example, the
billing month you're disputing. The page then shows summary tiles for that period
(uptime, outages and total downtime, packet loss, latency, quality score, average
measured speed) and a table of every detected event.

## The three export formats

- **Evidence report (HTML)** — the one to send. A single self-contained web page: summary
  statistics, the outage table with exact timestamps and durations, a speed-versus-plan
  chart, and a methodology appendix explaining precisely how every number was computed.
  It has no external dependencies, prints cleanly, and can be saved to PDF straight from
  the browser (File → Print → Save as PDF).
- **Raw data (CSV)** — the same events, daily summaries, and speed tests as spreadsheet
  data, for your own charts.
- **Raw data (JSON)** — the complete structured data, including the raw evidence captured
  during each event, for anyone who wants to verify or analyze everything themselves.

## Reading the report honestly

Three things in the report matter when you use it with your ISP:

**Classification.** Every outage is labeled with where the fault was observed:

| Label | Meaning | Use in a complaint |
|---|---|---|
| `isp` | Your router was fine, but the ISP's equipment stopped responding | This is the core of your case |
| `upstream` | Your router *and* the ISP's equipment were fine; only the wider internet was unreachable | Worth mentioning, but may not be your ISP's fault |
| `lan` | Your own router wasn't responding | **Excluded from claims** — this was inside your home |

The `lan` label is what makes the rest credible: Trapline visibly separates your problems
from theirs, so the "it's your equipment" deflection can be answered with data.

**Coverage %.** The fraction of the period Trapline was actually running. If the
monitoring computer was off for a weekend, that time is *excluded* from uptime math and
disclosed — downtime is never inferred from gaps in monitoring. A report with 98%
coverage says so, right up front.

**Methodology appendix.** The report ends with the exact thresholds, formulas, and test
endpoints used. Combined with the open source code, this means the ISP's own engineers
can verify every number — which is exactly what you want.

## Suggested way to use a report

1. Export the HTML report for the period with the problems.
2. Open a support ticket (email is better than phone — you want a written record) and
   attach the report or the key numbers from it.
3. Lead with the specifics: *"Between March 3 and March 28 my connection dropped 9 times
   for a total of 3 h 12 m; every incident is time-stamped in the attached report. During
   each one my own router stayed reachable while your first hop did not respond."*
4. If the response is generic, ask for the ticket to be escalated to the network team and
   offer the CSV/JSON data. Engineers tend to take time-stamped measurements seriously.

Polite, specific, and backed by data beats angry and vague, every time.
