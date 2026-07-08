/**
 * CLI entry point. Parses flags, maps them onto TRAPLINE_* env vars, then
 * imports the server (config reads env at import time, so the import must
 * happen after the flags are applied).
 *
 * Trapline — community ISP service-quality monitor.
 * Copyright (C) 2026 l-small-tech
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 */
import { spawn } from 'node:child_process';
import { isSea } from './sea.js';

const HELP = `Trapline — community ISP service-quality monitor

Usage: trapline [options]

Options:
  --port <n>        Port to listen on (default 8731; env TRAPLINE_PORT)
  --host <addr>     Address to bind (default 127.0.0.1; env TRAPLINE_HOST)
  --data-dir <dir>  Where measurements are stored (env TRAPLINE_DATA_DIR)
  --no-browser      Don't open the dashboard in a browser on start
                    (env TRAPLINE_NO_BROWSER=1)
  --version         Print version and exit
  --help            Show this help

Once running, the dashboard is at http://127.0.0.1:<port>/trapline/
`;

function fail(msg: string): never {
  console.error(`trapline: ${msg}\n`);
  console.error(HELP);
  process.exit(1);
}

interface CliFlags {
  noBrowser: boolean;
  wantVersion: boolean;
  wantHelp: boolean;
}

/** Applies value flags to process.env; returns the boolean flags. */
function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = { noBrowser: false, wantVersion: false, wantHelp: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) fail(`${arg} requires a value`);
      return v;
    };
    switch (arg) {
      case '--port': {
        const port = Number(next());
        if (!Number.isInteger(port) || port < 1 || port > 65535) fail('--port must be 1-65535');
        process.env.TRAPLINE_PORT = String(port);
        break;
      }
      case '--host':
        process.env.TRAPLINE_HOST = next();
        break;
      case '--data-dir':
        process.env.TRAPLINE_DATA_DIR = next();
        break;
      case '--no-browser':
        flags.noBrowser = true;
        break;
      case '--version':
      case '-v':
        flags.wantVersion = true;
        break;
      case '--help':
      case '-h':
        flags.wantHelp = true;
        break;
      default:
        fail(`unknown option: ${arg}`);
    }
  }
  return flags;
}

function openBrowser(url: string): void {
  try {
    const [cmd, args] =
      process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin'
          ? ['open', [url]]
          : ['xdg-open', [url]];
    spawn(cmd, args as string[], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {
    // best effort — the URL is printed either way
  }
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.wantHelp) {
    console.log(HELP);
    return;
  }
  const { VERSION } = await import('./config.js');
  if (flags.wantVersion) {
    console.log(`trapline v${VERSION} (node ${process.versions.node}, ${process.platform}-${process.arch})`);
    return;
  }

  const { startServer } = await import('./app.js');
  try {
    const { url } = await startServer();
    if (isSea()) {
      const { DATA_DIR } = await import('./config.js');
      console.log('');
      console.log(`  Trapline v${VERSION} is running: ${url}`);
      console.log(`  Measurements are stored in: ${DATA_DIR}`);
      console.log('  Keep this window open to keep monitoring. Press Ctrl+C to stop.');
      console.log('');
      if (!flags.noBrowser && process.env.TRAPLINE_NO_BROWSER !== '1') openBrowser(url);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      const { PORT } = await import('./config.js');
      console.error(
        `trapline: port ${PORT} is already in use — is Trapline already running?\n` +
          `Open http://127.0.0.1:${PORT}/trapline/ to check, or start with --port ${PORT + 1}.`,
      );
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
