# Frequently asked questions

## Does Trapline send my data anywhere?

No. Everything Trapline measures is stored in a single database file on your own
computer, and the web pages are served from your own computer. Nothing is uploaded,
there are no accounts, no analytics, no cloud. The only network traffic Trapline creates
is the measurements themselves (pings, name lookups, small web checks, and speed tests
against public endpoints). A report leaves your machine only when *you* export it and
send it to someone.

## Will it slow down my internet?

In Normal mode, no — the background probes amount to a few megabytes per day, and the
four daily speed tests take about 20 seconds each at random times. If you notice a speed
test while gaming, that's the worst of it. Homes with data caps can use Eco mode
(see [Data usage](data-usage.md)).

## Windows (or macOS) warns me about the downloaded program. Is it safe?

The warning appears because the standalone Trapline program isn't code-signed
(Windows) or notarized by Apple (macOS) — both require paid certificates that this free
project doesn't buy. It does *not* mean anything harmful was found. On Windows, click
**More info → Run anyway** on the SmartScreen prompt. On macOS, remove the quarantine
flag once in Terminal: `xattr -d com.apple.quarantine <the downloaded file>`.

If you'd rather verify than trust: every release includes a `SHA256SUMS.txt` file —
compare your download's checksum against it (`sha256sum -c SHA256SUMS.txt
--ignore-missing`, or `shasum -a 256 -c` on macOS). Better still, each binary carries a
cryptographic *provenance attestation* proving it was built by GitHub's own servers
directly from Trapline's published source code — verify it with the GitHub CLI:
`gh attestation verify <the downloaded file> --repo l-small-tech/Trapline`. That's a
stronger guarantee than a code-signing certificate, which only proves someone paid for
a certificate.

## Can I run Trapline over WiFi?

It will run, but you shouldn't — connect the monitoring computer to your router with an
Ethernet cable. WiFi has interruptions of its own (interference, distance, busy
neighbours' networks), and Trapline can't tell those apart from real internet problems:
a report gathered over WiFi overstates your problems and gives the ISP a fair reason to
dismiss it. Trapline detects when it's running on WiFi and shows a warning banner on the
Dashboard until you plug in. After connecting the cable, click **Re-discover router &
ISP hop** on the Settings page (or just restart Trapline).

## Can I trust the numbers? Can my ISP?

That's the design goal. Trapline follows strict honesty rules: time when the monitor
wasn't running is disclosed and never counted as downtime; problems inside your home are
labeled and excluded from ISP claims; every event stores its raw evidence; and every
report ends with the exact formulas and thresholds used. The source code is open under
the GPL, so anyone — including the ISP's engineers — can audit precisely how every number
was produced. A tool that only ever blamed the ISP would be useless; one that shows its
work is hard to dismiss.

## Is this fair to the ISP?

Yes, deliberately so — see [Why Trapline exists](../PURPOSE.md). Trapline distinguishes
"your home equipment failed" from "the ISP's network failed" from "the problem was beyond
the ISP entirely," and labels each accordingly. The point is to give the ISP feedback
good enough to act on, not to manufacture complaints.

## My monitoring computer was off for a while. Is my report ruined?

No. The report simply shows lower "coverage" for that period and excludes the gap from
all uptime math. The statistics for the time Trapline *was* running remain exact.

## What if my internet is satellite, not fiber?

Trapline works on any connection — it measures reachability, latency, loss, and speed the
same way. The fault classification is tuned for wired networks (router → ISP equipment →
internet), and a satellite link's "first hop" behaves differently, so expect the
`isp`/`upstream` distinction to be less meaningful. Uptime, outage, and speed evidence
remain just as valid.

## Why is it called Trapline?

A trapline is a route through the bush that a trapper walks on a regular schedule,
checking every trap and keeping careful records. Trapline does the same with your
internet connection: regular rounds, every check logged, nothing relied on from memory.

## Something's not working — where do I look?

If you use the standalone download, look at the console window it runs in — that's where
Trapline logs what it's doing — and restarting the program fixes most transient problems.
If you installed it as a Linux service, run `./trapline status` in a terminal on the
monitoring computer: it reports whether the service is running and healthy;
`./trapline logs` shows what the service is doing and `./trapline restart` restarts it.
If the Settings page warns that `mtr` is missing, install it with
`sudo apt install mtr-tiny` (Linux) or `brew install mtr` (macOS); there is no mtr for
Windows, and Trapline simply skips that evidence there.
