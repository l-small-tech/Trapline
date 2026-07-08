import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePingLine } from '../src/probes/ping.js';

// Real output shapes from iputils ping 20240117 (Linux Mint 22 / Ubuntu 24.04).

test('parses a normal reply line', () => {
  const r = parsePingLine('64 bytes from 1.1.1.1: icmp_seq=42 ttl=58 time=23.4 ms');
  assert.deepEqual(r, { kind: 'reply', seq: 42, rttMs: 23.4 });
});

test('parses a reply without ttl', () => {
  const r = parsePingLine('64 bytes from 192.168.1.1: icmp_seq=7 time=0.512 ms');
  assert.deepEqual(r, { kind: 'reply', seq: 7, rttMs: 0.512 });
});

test('parses -O "no answer yet" as a timeout', () => {
  const r = parsePingLine('no answer yet for icmp_seq=13');
  assert.deepEqual(r, { kind: 'timeout', seq: 13 });
});

test('parses destination unreachable as an error with seq', () => {
  const r = parsePingLine('From 10.0.0.1 icmp_seq=5 Destination Host Unreachable');
  assert.equal(r.kind, 'error');
  assert.equal((r as { seq: number }).seq, 5);
});

test('header and summary lines are noise', () => {
  assert.equal(parsePingLine('PING 1.1.1.1 (1.1.1.1) 56(84) bytes of data.').kind, 'noise');
  assert.equal(parsePingLine('--- 1.1.1.1 ping statistics ---').kind, 'noise');
  assert.equal(parsePingLine('5 packets transmitted, 5 received, 0% packet loss, time 4005ms').kind, 'noise');
  assert.equal(parsePingLine('rtt min/avg/max/mdev = 22.1/23.0/24.2/0.7 ms').kind, 'noise');
  assert.equal(parsePingLine('').kind, 'noise');
});

test('duplicate and damaged replies still parse as replies', () => {
  const r = parsePingLine('64 bytes from 1.1.1.1: icmp_seq=3 ttl=58 time=23.4 ms (DUP!)');
  assert.deepEqual(r, { kind: 'reply', seq: 3, rttMs: 23.4 });
});

// ---------------------------------------------------------------- macOS (BSD)
// Real output shapes from macOS ping (BSD). Replies share the Linux format;
// timeouts use "Request timeout"; icmp_seq starts at 0.

test('darwin: parses a reply line', () => {
  const r = parsePingLine('64 bytes from 1.1.1.1: icmp_seq=0 ttl=57 time=23.456 ms');
  assert.deepEqual(r, { kind: 'reply', seq: 0, rttMs: 23.456 });
});

test('darwin: parses "Request timeout" as a timeout', () => {
  const r = parsePingLine('Request timeout for icmp_seq 5');
  assert.deepEqual(r, { kind: 'timeout', seq: 5 });
});

test('darwin: header and summary lines are noise', () => {
  assert.equal(parsePingLine('PING 1.1.1.1 (1.1.1.1): 56 data bytes').kind, 'noise');
  assert.equal(parsePingLine('round-trip min/avg/max/stddev = 22.1/23.0/24.2/0.7 ms').kind, 'noise');
});
