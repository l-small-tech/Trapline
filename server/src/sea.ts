/**
 * Safe wrappers around node:sea. `isSea()` is the switch between the two
 * distributions of Trapline: running from a git checkout (tsx/Docker,
 * repo-relative data dir, web UI served from web/dist) and running as a
 * single-file release executable (platform data dir, web UI embedded as
 * SEA assets).
 */
import sea from 'node:sea';

export function isSea(): boolean {
  try {
    return sea.isSea();
  } catch {
    return false;
  }
}

export function getAsset(key: string): Buffer {
  return Buffer.from(sea.getAsset(key));
}

export function getAssetText(key: string): string {
  return sea.getAsset(key, 'utf8');
}
