import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultRouteIface } from '../src/probes/netinfo.js';

describe('defaultRouteIface', () => {
  it('picks the dev of the first default route', () => {
    assert.equal(
      defaultRouteIface([
        { dev: 'eth0' },
        { dev: 'wlan0' },
      ]),
      'eth0',
    );
  });

  it('skips entries without a dev', () => {
    assert.equal(defaultRouteIface([{}, { dev: 'wlp3s0' }]), 'wlp3s0');
  });

  it('returns null when there is no default route', () => {
    assert.equal(defaultRouteIface([]), null);
  });

  it('accepts common interface name styles', () => {
    for (const dev of ['enp5s0', 'wlan0', 'br-lan', 'eth0.100', 'bond0']) {
      assert.equal(defaultRouteIface([{ dev }]), dev);
    }
  });

  it('rejects names that could escape a /sys path', () => {
    assert.equal(defaultRouteIface([{ dev: '../etc' }]), null);
    assert.equal(defaultRouteIface([{ dev: 'eth0/../x' }]), null);
    assert.equal(defaultRouteIface([{ dev: '' }]), null);
  });
});
