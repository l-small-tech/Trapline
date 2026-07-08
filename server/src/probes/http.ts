/**
 * HTTP reachability probe: small GETs against well-known always-up
 * endpoints, measuring time-to-first-byte and total time over a keep-alive
 * connection pool.
 */
import { Agent, request } from 'undici';

export interface HttpProbeResult {
  ts: number;
  url: string;
  status: number | null;
  ttfbMs: number | null;
  totalMs: number | null;
  success: boolean;
  error: string | null;
  /** Approximate wire bytes for the usage ledger. */
  bytesApprox: number;
}

const agent = new Agent({ connections: 4, keepAliveTimeout: 30_000 });

export async function httpCheck(url: string, timeoutMs = 5000): Promise<HttpProbeResult> {
  const ts = Date.now();
  const start = process.hrtime.bigint();
  let bytes = 300; // request line + headers estimate
  try {
    const res = await request(url, {
      method: 'GET',
      dispatcher: agent,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    const ttfbMs = Number(process.hrtime.bigint() - start) / 1e6;
    let bodyBytes = 0;
    for await (const chunk of res.body) bodyBytes += (chunk as Buffer).length;
    const totalMs = Number(process.hrtime.bigint() - start) / 1e6;
    bytes += bodyBytes + 300; // response headers estimate
    const success = res.statusCode >= 200 && res.statusCode < 400;
    return {
      ts,
      url,
      status: res.statusCode,
      ttfbMs,
      totalMs,
      success,
      error: success ? null : `HTTP ${res.statusCode}`,
      bytesApprox: bytes,
    };
  } catch (err) {
    const totalMs = Number(process.hrtime.bigint() - start) / 1e6;
    return {
      ts,
      url,
      status: null,
      ttfbMs: null,
      totalMs,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      bytesApprox: bytes,
    };
  }
}
