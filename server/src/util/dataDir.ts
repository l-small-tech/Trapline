/**
 * Per-platform default data directory for the standalone executable.
 * Source checkouts keep using <repo>/data; TRAPLINE_DATA_DIR overrides both.
 */
import os from 'node:os';
import path from 'node:path';

export function platformDataDir(): string {
  switch (process.platform) {
    case 'win32':
      return path.join(
        process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
        'Trapline',
      );
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Trapline');
    default:
      return process.env.XDG_DATA_HOME
        ? path.join(process.env.XDG_DATA_HOME, 'trapline')
        : path.join(os.homedir(), '.local', 'share', 'trapline');
  }
}
