# Tools — "is it me or the ISP, right now?"

The Tools page is for the moment something feels wrong and you want an answer *now*,
rather than waiting for the background monitoring to write history. Five one-click
checks:

## Health check

The one to reach for first. In about ten seconds it pings everything Trapline watches
(your router, the ISP's equipment, the internet anchors), does a name lookup, and fetches
a small web page — then gives a verdict: **good**, **degraded**, or **bad**, with a
plain-language explanation and the individual results underneath. The pattern of what
failed tells you where the problem is.

## Speed test

Runs the same measurement as the scheduled tests, with live progress: download speed,
upload speed, and a **bufferbloat grade**. Bufferbloat is what makes video calls fall
apart the moment someone starts a big download — the line is "fast" but everything else
queues behind the transfer. Trapline measures how much your response time worsens while
the line is loaded and grades it A (barely) to F (badly).

Note: a speed test moves real data — typically 100–300 MB per run. Keep that in mind if
you have a data cap.

## DNS speed check

DNS is the internet's phone book — every website visit starts with a lookup. If lookups
are slow, *everything* feels slow even when the line itself is fine. This tool times your
ISP-assigned resolver against three well-known public ones (Cloudflare 1.1.1.1, Google
8.8.8.8, Quad9 9.9.9.9) and shows the comparison. If your resolver is consistently much
slower, that's useful feedback for the ISP — or a reason to switch resolvers.

## Ping a host

Sends ten quick "are you there?" messages to any address you type and reports the typical
response time and how many went unanswered. Handy for checking a specific service ("is it
just this game server?").

## Trace the route (mtr)

Maps the path your traffic takes to a destination, hop by hop — your router, the ISP's
equipment, and onward — showing response time and loss at every step. When something is
broken, this shows *where along the road* it breaks, which is exactly the kind of detail
a network engineer wants. Takes about 15 seconds.

---

Everything the Tools page measures is also fed into Trapline's records, so a revealing
manual test during an incident becomes part of your evidence too.
