/**
 * Data-usage ledger: every probe reports (estimated or exact) wire bytes
 * here; totals are accumulated in memory and flushed to
 * data_usage_hourly once a minute with UPSERT increments.
 */
import type { UsageCategory } from '../../../shared/types.js';
import type { Repo } from '../db/repo.js';
import { hourStart } from '../util/time.js';

type Key = `${UsageCategory}:${0 | 1}`;

export class UsageLedger {
  private pending = new Map<Key, { sent: number; recv: number }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private repo: Repo) {}

  start(flushIntervalMs = 60_000): void {
    this.timer = setInterval(() => this.flush(), flushIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.flush();
  }

  add(category: UsageCategory, isLan: boolean, sent: number, recv: number): void {
    const key: Key = `${category}:${isLan ? 1 : 0}`;
    const cur = this.pending.get(key) ?? { sent: 0, recv: 0 };
    cur.sent += sent;
    cur.recv += recv;
    this.pending.set(key, cur);
  }

  flush(): void {
    if (this.pending.size === 0) return;
    const hour = hourStart(Date.now());
    for (const [key, v] of this.pending) {
      const [category, lan] = key.split(':') as [UsageCategory, string];
      this.repo.addUsage(hour, category, lan === '1', v.sent, v.recv);
    }
    this.pending.clear();
  }
}
