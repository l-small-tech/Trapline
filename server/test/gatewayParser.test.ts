import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDarwinRouteGet, parseWindowsRouteJson } from '../src/probes/discovery.js';
import { parseHardwarePorts, parseIfconfigMediaMbps, parseWindowsAdapterJson } from '../src/probes/netinfo.js';

// ---------------------------------------------------------------- macOS

const DARWIN_ROUTE_GET = `   route to: default
destination: default
       mask: default
    gateway: 192.168.1.1
  interface: en0
      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>
 recvpipe  sendpipe  ssthresh  rtt,msec    rttvar  hopcount      mtu     expire
       0         0         0         0         0         0      1500         0
`;

test('darwin route get: extracts gateway and interface', () => {
  assert.deepEqual(parseDarwinRouteGet(DARWIN_ROUTE_GET), { gateway: '192.168.1.1', iface: 'en0' });
});

test('darwin route get: missing fields are null', () => {
  assert.deepEqual(parseDarwinRouteGet('route: writing to routing socket: not in table\n'), {
    gateway: null,
    iface: null,
  });
  assert.deepEqual(parseDarwinRouteGet(''), { gateway: null, iface: null });
});

const HARDWARE_PORTS = `Hardware Port: Ethernet Adapter (en4)
Device: en4
Ethernet Address: 00:e0:4c:68:00:01

Hardware Port: Wi-Fi
Device: en0
Ethernet Address: f0:18:98:aa:bb:cc

Hardware Port: Thunderbolt Bridge
Device: bridge0
Ethernet Address: 36:5c:52:xx:yy:zz
`;

test('darwin hardware ports: maps device to port name', () => {
  const ports = parseHardwarePorts(HARDWARE_PORTS);
  assert.equal(ports.get('en0'), 'Wi-Fi');
  assert.equal(ports.get('en4'), 'Ethernet Adapter (en4)');
  assert.equal(ports.get('missing'), undefined);
});

test('darwin ifconfig media line: extracts Mbps', () => {
  assert.equal(parseIfconfigMediaMbps('	media: autoselect (1000baseT <full-duplex>)'), 1000);
  assert.equal(parseIfconfigMediaMbps('	media: autoselect (100baseTX <full-duplex>)'), 100);
  assert.equal(parseIfconfigMediaMbps('	media: autoselect'), null);
  assert.equal(parseIfconfigMediaMbps(''), null);
});

// ---------------------------------------------------------------- Windows
// Real ConvertTo-Json output captured on Windows 11 (PowerShell 5.1).

const WIN_ROUTE_JSON = `{
    "NextHop":  "192.168.8.1",
    "InterfaceIndex":  8
}`;

test('windows route json: single object', () => {
  assert.deepEqual(parseWindowsRouteJson(WIN_ROUTE_JSON), { nextHop: '192.168.8.1', interfaceIndex: 8 });
});

test('windows route json: array form and BOM', () => {
  const arr = `﻿[${WIN_ROUTE_JSON}, {"NextHop": "10.0.0.1", "InterfaceIndex": 12}]`;
  assert.deepEqual(parseWindowsRouteJson(arr), { nextHop: '192.168.8.1', interfaceIndex: 8 });
});

test('windows route json: on-link/empty/garbage → null', () => {
  assert.deepEqual(parseWindowsRouteJson('{"NextHop": "0.0.0.0", "InterfaceIndex": 3}'), {
    nextHop: null,
    interfaceIndex: 3,
  });
  assert.deepEqual(parseWindowsRouteJson(''), { nextHop: null, interfaceIndex: null });
  assert.deepEqual(parseWindowsRouteJson('Get-NetRoute : not recognized'), {
    nextHop: null,
    interfaceIndex: null,
  });
});

const WIN_ADAPTER_JSON = `{
    "Name":  "Wi-Fi",
    "InterfaceDescription":  "Intel(R) Wi-Fi 6E AX210 160MHz",
    "PhysicalMediaType":  "Native 802.11",
    "NdisPhysicalMedium":  9,
    "LinkSpeed":  "432 Mbps"
}`;

test('windows adapter json: wifi adapter detected, no wired speed reported', () => {
  assert.deepEqual(parseWindowsAdapterJson(WIN_ADAPTER_JSON), {
    iface: 'Wi-Fi',
    wireless: true,
    linkSpeedMbps: null, // link rate only matters for wired NICs
  });
});

test('windows adapter json: wired gigabit adapter', () => {
  const wired = `{
    "Name":  "Ethernet",
    "InterfaceDescription":  "Realtek PCIe GbE Family Controller",
    "PhysicalMediaType":  "802.3",
    "NdisPhysicalMedium":  14,
    "LinkSpeed":  "1 Gbps"
}`;
  assert.deepEqual(parseWindowsAdapterJson(wired), {
    iface: 'Ethernet',
    wireless: false,
    linkSpeedMbps: 1000,
  });
});

test('windows adapter json: garbage → all null', () => {
  assert.deepEqual(parseWindowsAdapterJson('') , { iface: null, wireless: null, linkSpeedMbps: null });
  assert.deepEqual(parseWindowsAdapterJson('err'), { iface: null, wireless: null, linkSpeedMbps: null });
});
