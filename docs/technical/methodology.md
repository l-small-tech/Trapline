# Measurement methodology

This document is the auditable specification of how Trapline detects problems, assigns
blame, and computes every statistic that appears in a report. The same methodology is
printed in the appendix of every exported HTML report. Implementation:
`server/src/monitor/detector.ts` (all thresholds are named constants at the top of the
file), `server/src/util/stats.ts`, `server/src/util/mos.ts`.

## What is probed

- **ICMP ping**, continuously, to: the home router (gateway), the ISP's first hop
  (auto-discovered as the first *public* responding hop of a route trace), and public
  anchors (Cloudflare `1.1.1.1`, Google `8.8.8.8`). Interval per mode: 30 s / 5 s / 1 s
  (Eco / Normal / Full Capture).
- **DNS**: timed lookups of well-known hostnames through the machine's own resolver
  (2 s timeout).
- **HTTP**: small fetches of always-on endpoints with time-to-first-byte.
- **Speed**: multi-stream HTTP download (5 streams) and upload (3 streams) against
  configurable endpoints (default: Cloudflare's public speed service), on a randomized
  daily schedule, with latency sampled under load.
- **Route evidence**: an `mtr` trace captured automatically when an event opens
  (rate-limited per mode).

## Measurement vantage

Every number is measured from the machine Trapline runs on, so it includes that
machine's own link to the router. **For evidence attributable to the ISP, the monitoring
machine must be wired (Ethernet) to the router.** WiFi adds loss, jitter, and throughput
ceilings of its own that are indistinguishable, from this vantage point, from line
problems; a report gathered over WiFi is fairly disputable.

Trapline verifies the vantage point itself (`server/src/probes/netinfo.ts`): at startup,
on every target re-discovery, and every 15 minutes it resolves the default-route
interface (`ip -j route show default`), checks whether it is wireless
(`/sys/class/net/<iface>/wireless`), and reads the negotiated rate of wired NICs
(`/sys/class/net/<iface>/speed`). The result is exposed as `link` in `GET /status`, and
the UI shows a warning banner when it detects WiFi, or a wired port negotiated below the
plan's download speed (which caps speed tests below the plan regardless of the ISP).
Detection is best-effort — in VMs and unusual containers the fields are `null` and no
warning is shown — so the operator remains responsible for the vantage point.

## Event detection rules

**Outage.** Opens when ≥ 3 *consecutive* probes are lost on **every** enabled
internet-side (WAN) target simultaneously. Closes after ≥ 3 consecutive replies on at
least two WAN targets (or the only one, if just one is enabled). The event's start is
backdated to the first lost probe and its end set to the first successful one, so
durations are exact to within one probe interval.

**Packet loss.** Opens at ≥ 5% loss over the trailing 60 samples on ≥ 2 WAN targets;
closes when all targets are back under 2% over 120 samples.

**Latency spike** (relative to your line's own history). Each target keeps an ~1-hour
EWMA baseline of RTT. A spike opens when the 60-second rolling median exceeds
max(2 × baseline, baseline + 30 ms) sustained for ≥ 30 s on ≥ 2 WAN targets; closes after
60 s below 1.3 × baseline.

**High latency** (absolute). Opens when the 60-second rolling median exceeds the
user-set threshold (default 120 ms; 0 disables) sustained ≥ 30 s on ≥ 2 WAN targets;
closes after 60 s below 90% of the threshold on all targets.

**DNS failure.** Opens after 2 consecutive system-resolver failures (a failure is an
error, a timeout, or an answer slower than 2 s); closes on 2 consecutive successes.

**Speed degradation.** A speed test measuring below `speedDegradationFraction` (default
0.5) of the advertised plan speed records an event.

## Fault classification

Every event is classified by what else was observable while it was open:

| Observation | Classification | Treatment |
|---|---|---|
| The home router was also unreachable | `lan` | Problem inside the home; **excluded from ISP claims** |
| Router fine, ISP first hop unresponsive | `isp` | The ISP's network failed |
| Router and ISP hop fine, only far targets dead | `upstream` | Trouble beyond the ISP |
| Insufficient signal to distinguish | `unknown` | Reported as unknown, never guessed |

## Honesty rules

These rules are structural, not policy — the code cannot produce a report that violates
them:

1. **Coverage is disclosed.** Time when the monitor itself wasn't running is excluded
   from uptime math and reported as "coverage %". Downtime is never inferred from gaps
   in monitoring; a restart records an explicit `monitor_gap` rather than a guess.
2. **`lan` events are labeled and excluded** from ISP-facing statistics, front and
   center.
3. **Evidence is preserved raw.** Every event stores the surrounding ping samples
   (± 120 s) and, where possible, an mtr route trace captured while the problem was
   live — showing where along the route packets died.
4. **Methodology travels with the data.** Every report embeds these thresholds, the
   formulas below, and the endpoints used.

## Statistics

- **Uptime %** = 1 − (outage time / covered time), where covered time excludes monitor
  gaps. `lan`-classified outages are excluded from the ISP-facing figure.
- **Latency p50/p95** — percentiles with linear interpolation over raw samples (or
  hourly rollups for long ranges).
- **Jitter** — mean absolute difference between consecutive RTT samples.
- **Packet loss %** — lost probes / total probes over the period.
- **Bufferbloat grade** — idle median RTT vs worst loaded median RTT during a speed
  test; the increase is graded A (< small) through F (severe).

## Quality score (MOS)

The 1–5 quality score is the simplified ITU-T G.107 E-model, computed from measured
latency, jitter, and loss (`server/src/util/mos.ts`):

```
d   = RTT_p50 / 2 + jitter / 2              (one-way delay estimate, ms)
Id  = 0.024·d + 0.11·(d − 177.3)·H(d − 177.3)     (delay impairment; H = step function)
Ie  = 30·ln(1 + 15·loss_fraction)                  (loss impairment)
R   = clamp(93.2 − Id − Ie, 0, 100)
MOS = clamp(1 + 0.035·R + 7×10⁻⁶·R·(R − 60)·(100 − R), 1, 5)
```

This is the standard formula used to predict voice-call quality; 4+ is good, below 3 is
poor.

## Speed test design

Idle latency is measured first, then a short preflight sizes the transfer, then parallel
HTTP streams run for a target duration (capped at 100 MB per stream). Latency is sampled
throughout the loaded phases. Every byte moved is recorded in the usage ledger — the
data cost of measurement is itself measured, not estimated.

## Reproducing any number

Export the JSON report for the same period: it contains the full structured payload —
events with raw evidence, daily summaries, speed tests — from which every figure in the
HTML report can be recomputed. The database itself (`data/trapline.db`, standard SQLite)
is the ultimate source of truth.
