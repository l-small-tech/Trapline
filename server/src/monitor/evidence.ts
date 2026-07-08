/**
 * Evidence capture: when an event opens we grab an mtr trace (rate-limited
 * per mode); when it closes we attach the raw ping samples from ±120s
 * around the event window so the report can show exactly what happened.
 */
import type { MonitorEvent, Target } from '../../../shared/types.js';
import { EST_BYTES, MODES } from '../config.js';
import type { Repo } from '../db/repo.js';
import { runMtr } from '../probes/mtr.js';
import type { Mode } from '../../../shared/types.js';
import type { UsageLedger } from './usage.js';

const PING_WINDOW_MS = 120_000;
const EVIDENCE_EVENT_KINDS = new Set(['outage', 'latency_spike', 'packet_loss']);

export class EvidenceCollector {
  private lastMtrAt = 0;
  mtrAvailable = false;

  constructor(
    private repo: Repo,
    private usage: UsageLedger,
    private getMode: () => Mode,
    private getTargets: () => Target[],
    private log: (msg: string) => void,
  ) {}

  /** Fire-and-forget mtr capture when an event opens. */
  onEventOpened(event: MonitorEvent): void {
    if (!EVIDENCE_EVENT_KINDS.has(event.kind)) return;
    const minGap = MODES[this.getMode()].mtrMinGapMs;
    if (!this.mtrAvailable || minGap === null) return;
    const now = Date.now();
    if (now - this.lastMtrAt < minGap) return;
    this.lastMtrAt = now;

    const hosts = new Set<string>(['1.1.1.1']);
    const ispHop = this.getTargets().find((t) => t.kind === 'isp_hop');
    if (ispHop) hosts.add(ispHop.host);

    for (const host of hosts) {
      runMtr(host, 10)
        .then(({ result, error }) => {
          this.usage.add('mtr', false, EST_BYTES.mtrTrace / 2, EST_BYTES.mtrTrace / 2);
          if (result) {
            this.repo.addEvidence(event.id, 'mtr', result.capturedAt, result);
          } else if (error) {
            this.log(`mtr evidence capture to ${host} failed: ${error}`);
          }
        })
        .catch((err) => this.log(`mtr evidence error: ${String(err)}`));
    }
  }

  /** Attach the raw ping window once the event has closed. */
  onEventClosed(event: MonitorEvent): void {
    if (!EVIDENCE_EVENT_KINDS.has(event.kind)) return;
    const from = event.startedAt - PING_WINDOW_MS;
    const to = (event.endedAt ?? Date.now()) + PING_WINDOW_MS;
    try {
      const samples = this.repo.getPingSamples(from, to);
      // Cap the snapshot so a multi-hour episode cannot bloat the DB.
      const capped = samples.length > 5000 ? samples.slice(0, 5000) : samples;
      this.repo.addEvidence(event.id, 'ping_window', Date.now(), {
        from,
        to,
        truncated: capped.length < samples.length,
        targets: this.getTargets().map((t) => ({ id: t.id, host: t.host, label: t.label })),
        samples: capped,
      });
    } catch (err) {
      this.log(`ping window evidence failed: ${String(err)}`);
    }
  }
}
