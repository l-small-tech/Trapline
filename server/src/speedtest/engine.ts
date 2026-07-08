/**
 * Speed-test orchestrator: idle latency → preflight → download → upload →
 * bufferbloat grade. Only one test runs at a time; every byte moved is
 * recorded in the usage ledger and on the result row itself.
 */
import type { SpeedTestProgress, SpeedTestResult, SseMessage } from '../../../shared/types.js';
import type { Repo } from '../db/repo.js';
import type { UsageLedger } from './../monitor/usage.js';
import { preflightDownload, runDownload } from './download.js';
import { bufferbloatGrade, LoadedLatencySampler, measureIdleLatency } from './latency.js';
import { runUpload } from './upload.js';

interface Broadcaster {
  broadcast(msg: SseMessage): void;
}

const DOWNLOAD_STREAMS = 5;
const DOWNLOAD_TARGET_MS = 12_000;
const DOWNLOAD_WALL_MS = 15_000;
const UPLOAD_STREAMS = 3;
const UPLOAD_TARGET_MS = 8_000;
const UPLOAD_WALL_MS = 10_000;
const MAX_BYTES_PER_STREAM = 100_000_000;

export class SpeedTestEngine {
  private running = false;

  constructor(
    private repo: Repo,
    private usage: UsageLedger,
    private hub: Broadcaster,
    private log: (msg: string) => void,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  private progress(p: SpeedTestProgress): void {
    this.hub.broadcast({ type: 'speedtest', data: { progress: p } });
  }

  async run(trigger: 'scheduled' | 'manual'): Promise<SpeedTestResult | null> {
    if (this.running) {
      this.log('speed test already running — skipped');
      return null;
    }
    this.running = true;
    const startedAt = Date.now();
    const settings = this.repo.getSettings();
    const downUrl = settings.speedtestDownUrl;
    const upUrl = settings.speedtestUpUrl;
    let bytesDown = 0;
    let bytesUp = 0;

    try {
      // Phase 1: idle latency.
      this.progress({ phase: 'idle_latency', currentBps: 0, elapsedMs: 0 });
      const idle = await measureIdleLatency(downUrl);
      bytesDown += idle.bytesUsed;

      // Phase 2: preflight to size the main download.
      this.progress({ phase: 'preflight', currentBps: 0, elapsedMs: Date.now() - startedAt });
      const pre = await preflightDownload(downUrl);
      bytesDown += pre.bytes;
      const estBps = pre.bps ?? 20_000_000;

      // Phase 3: download, with loaded-latency sampling.
      const downSampler = new LoadedLatencySampler(downUrl);
      downSampler.start();
      const bytesPerStream = Math.min(
        MAX_BYTES_PER_STREAM,
        Math.max(2_000_000, Math.ceil((estBps * (DOWNLOAD_TARGET_MS / 1000)) / 8 / DOWNLOAD_STREAMS)),
      );
      const down = await runDownload({
        downUrl,
        streams: DOWNLOAD_STREAMS,
        bytesPerStream,
        maxDurationMs: DOWNLOAD_WALL_MS,
        rampMs: 2000,
        onProgress: (bps) =>
          this.progress({ phase: 'download', currentBps: bps, elapsedMs: Date.now() - startedAt }),
      });
      const loadedDown = await downSampler.stop();
      bytesDown += down.bytes + downSampler.bytesUsed;

      // Phase 4: upload, with loaded-latency sampling.
      const upSampler = new LoadedLatencySampler(downUrl);
      upSampler.start();
      const upBytesPerStream = Math.min(
        MAX_BYTES_PER_STREAM,
        Math.max(1_000_000, Math.ceil((estBps * (UPLOAD_TARGET_MS / 1000)) / 8 / UPLOAD_STREAMS)),
      );
      const up = await runUpload({
        upUrl,
        streams: UPLOAD_STREAMS,
        bytesPerStream: upBytesPerStream,
        maxDurationMs: UPLOAD_WALL_MS,
        rampMs: 1000,
        onProgress: (bps) =>
          this.progress({ phase: 'upload', currentBps: bps, elapsedMs: Date.now() - startedAt }),
      });
      const loadedUp = await upSampler.stop();
      bytesUp += up.bytes;
      bytesDown += upSampler.bytesUsed;

      // Grade: extra latency under load vs idle.
      let grade: SpeedTestResult['bufferbloatGrade'] = null;
      if (idle.medianMs !== null) {
        const worstLoaded = Math.max(loadedDown.medianMs ?? 0, loadedUp.medianMs ?? 0);
        if (worstLoaded > 0) grade = bufferbloatGrade(Math.max(0, worstLoaded - idle.medianMs));
      }

      // A phase that moved (almost) no data is a failure, not a 0 Mbps line.
      const failures: string[] = [];
      if (down.bps === null) failures.push('download phase failed (no data received)');
      if (up.bps === null) failures.push('upload phase failed (no data sent)');

      const result: Omit<SpeedTestResult, 'id'> = {
        ts: startedAt,
        trigger,
        downBps: down.bps,
        upBps: up.bps,
        idleLatencyMs: idle.medianMs,
        loadedDownMs: loadedDown.medianMs,
        loadedUpMs: loadedUp.medianMs,
        bufferbloatGrade: grade,
        bytesDown,
        bytesUp,
        durationMs: Date.now() - startedAt,
        error: failures.length ? failures.join('; ') : null,
      };
      const id = this.repo.insertSpeedTest({
        ...result,
        detail: {
          idleSamples: idle.samples,
          preflightBps: pre.bps,
          downloadStreams: DOWNLOAD_STREAMS,
          uploadStreams: UPLOAD_STREAMS,
          bytesPerStream,
          upBytesPerStream,
        },
      });
      this.usage.add('speedtest', false, bytesUp, bytesDown);
      const full: SpeedTestResult = { ...result, id };
      this.progress({ phase: 'done', currentBps: down.bps ?? 0, elapsedMs: full.durationMs });
      this.hub.broadcast({ type: 'speedtest', data: { result: full } });
      this.log(
        `speed test done: ${((down.bps ?? 0) / 1e6).toFixed(1)}↓ / ${((up.bps ?? 0) / 1e6).toFixed(1)}↑ Mbps, ` +
          `${(bytesDown / 1e6).toFixed(0)}MB down + ${(bytesUp / 1e6).toFixed(0)}MB up used, grade ${grade ?? 'n/a'}`,
      );
      return full;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`speed test failed: ${message}`);
      const result: Omit<SpeedTestResult, 'id'> = {
        ts: startedAt,
        trigger,
        downBps: null,
        upBps: null,
        idleLatencyMs: null,
        loadedDownMs: null,
        loadedUpMs: null,
        bufferbloatGrade: null,
        bytesDown,
        bytesUp,
        durationMs: Date.now() - startedAt,
        error: message,
      };
      const id = this.repo.insertSpeedTest(result);
      this.usage.add('speedtest', false, bytesUp, bytesDown);
      this.progress({ phase: 'error', currentBps: 0, elapsedMs: result.durationMs, message });
      this.hub.broadcast({ type: 'speedtest', data: { result: { ...result, id } } });
      return { ...result, id };
    } finally {
      this.running = false;
    }
  }
}
