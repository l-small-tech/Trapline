import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPingArgs, parseWindowsPingLine } from '../src/probes/ping.js';
import { buildBurstArgs } from '../src/probes/pingBurst.js';

// Real ping.exe output captured on Windows 11 (English locale). Lines end
// in \r because the stream splits on \n only.

test('win: parses a reply line (with trailing CR)', () => {
  const r = parseWindowsPingLine('Reply from 1.1.1.1: bytes=32 time=53ms TTL=53\r');
  assert.deepEqual(r, { kind: 'reply', rttMs: 53 });
});

test('win: "time<1ms" reports as 1', () => {
  const r = parseWindowsPingLine('Reply from 192.168.8.1: bytes=32 time<1ms TTL=64');
  assert.deepEqual(r, { kind: 'reply', rttMs: 1 });
});

test('win: localized reply still parses via TTL/ms tokens', () => {
  // German locale: "Antwort von 1.1.1.1: Bytes=32 Zeit=23ms TTL=57"
  const r = parseWindowsPingLine('Antwort von 1.1.1.1: Bytes=32 Zeit=23ms TTL=57\r');
  assert.deepEqual(r, { kind: 'reply', rttMs: 23 });
});

test('win: request timed out', () => {
  assert.equal(parseWindowsPingLine('Request timed out.\r').kind, 'timeout');
});

test('win: destination unreachable is an error', () => {
  assert.equal(parseWindowsPingLine('Reply from 192.168.8.1: Destination host unreachable.').kind, 'error');
  assert.equal(parseWindowsPingLine('PING: transmit failed. General failure.').kind, 'error');
});

test('win: header/statistics lines are noise', () => {
  assert.equal(parseWindowsPingLine('Pinging 1.1.1.1 with 32 bytes of data:\r').kind, 'noise');
  assert.equal(parseWindowsPingLine('Ping statistics for 1.1.1.1:\r').kind, 'noise');
  assert.equal(parseWindowsPingLine('    Minimum = 47ms, Maximum = 53ms, Average = 49ms\r').kind, 'noise');
  assert.equal(parseWindowsPingLine('').kind, 'noise');
});

// Note: "unreachable" replies contain no TTL, so they classify as error,
// and the statistics "Average = 49ms" line has no TTL either → noise. The
// probe stops at the first reply/timeout/error line, so summary lines are
// never consulted.

test('buildPingArgs: linux keeps iputils flags and sub-second intervals', () => {
  assert.deepEqual(buildPingArgs('linux', '1.1.1.1', 0.5, false), [
    '-n', '-O', '-W', '3', '-i', '0.5', '1.1.1.1',
  ]);
});

test('buildPingArgs: darwin clamps interval to 1s for non-root only', () => {
  assert.deepEqual(buildPingArgs('darwin', '1.1.1.1', 0.5, false), ['-n', '-i', '1', '1.1.1.1']);
  assert.deepEqual(buildPingArgs('darwin', '1.1.1.1', 0.5, true), ['-n', '-i', '0.5', '1.1.1.1']);
  assert.deepEqual(buildPingArgs('darwin', '1.1.1.1', 5, false), ['-n', '-i', '5', '1.1.1.1']);
});

test('buildBurstArgs per platform', () => {
  assert.deepEqual(buildBurstArgs('win32', '1.1.1.1', 5, false), ['-n', '5', '-w', '2000', '1.1.1.1']);
  assert.deepEqual(buildBurstArgs('darwin', '1.1.1.1', 5, false), ['-n', '-c', '5', '-i', '1', '1.1.1.1']);
  assert.deepEqual(buildBurstArgs('darwin', '1.1.1.1', 5, true), ['-n', '-c', '5', '-i', '0.3', '1.1.1.1']);
  assert.deepEqual(buildBurstArgs('linux', '1.1.1.1', 5, false), [
    '-n', '-O', '-W', '2', '-i', '0.3', '-c', '5', '1.1.1.1',
  ]);
});
