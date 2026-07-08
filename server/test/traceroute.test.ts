import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstPublicHop, parseTracerouteOutput, parseTracertOutput } from '../src/probes/traceroute.js';

// ---------------------------------------------------------- unix traceroute

const TRACEROUTE = `traceroute to 1.1.1.1 (1.1.1.1), 8 hops max, 60 byte packets
 1  192.168.1.1  0.512 ms
 2  *
 3  100.64.0.1  11.9 ms
 4  172.16.4.9  12.1 ms
 5  207.35.49.125  35.0 ms
 6  1.1.1.1  36.2 ms
`;

test('traceroute: hops parse with * as null', () => {
  assert.deepEqual(parseTracerouteOutput(TRACEROUTE), [
    '192.168.1.1',
    null,
    '100.64.0.1',
    '172.16.4.9',
    '207.35.49.125',
    '1.1.1.1',
  ]);
});

test('traceroute: empty/garbage input parses to no hops', () => {
  assert.deepEqual(parseTracerouteOutput(''), []);
  assert.deepEqual(parseTracerouteOutput('traceroute: unknown host\n'), []);
});

// ------------------------------------------------------------ win tracert
// Real tracert output captured on Windows 11 (English locale, CRLF).

const TRACERT = `\r
Tracing route to 1.1.1.1 over a maximum of 6 hops\r
\r
  1     3 ms     2 ms     3 ms  192.168.8.1 \r
  2    15 ms    18 ms    11 ms  10.130.228.3 \r
  3     *        *        *     Request timed out.\r
  4    13 ms    12 ms    20 ms  10.11.64.157 \r
  5    42 ms    34 ms    37 ms  10.1.2.105 \r
  6    39 ms    36 ms    77 ms  207.35.49.125 \r
\r
Trace complete.\r
`;

test('tracert: hops parse, timeouts as null', () => {
  assert.deepEqual(parseTracertOutput(TRACERT), [
    '192.168.8.1',
    '10.130.228.3',
    null,
    '10.11.64.157',
    '10.1.2.105',
    '207.35.49.125',
  ]);
});

test('tracert: sub-millisecond columns still parse', () => {
  const out = '  1    <1 ms    <1 ms    <1 ms  192.168.0.1 \r\n';
  assert.deepEqual(parseTracertOutput(out), ['192.168.0.1']);
});

// ------------------------------------------------------------ firstPublicHop

test('firstPublicHop: skips private/CGNAT and nulls', () => {
  assert.equal(
    firstPublicHop(['192.168.8.1', '10.130.228.3', null, '100.64.0.1', '207.35.49.125'], '1.1.1.1'),
    '207.35.49.125',
  );
});

test('firstPublicHop: anchor reached first → null (no distinct ISP hop)', () => {
  assert.equal(firstPublicHop(['192.168.1.1', '1.1.1.1'], '1.1.1.1'), null);
});

test('firstPublicHop: all private → null', () => {
  assert.equal(firstPublicHop(['192.168.1.1', '10.0.0.1', null], '1.1.1.1'), null);
});
