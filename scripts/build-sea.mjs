#!/usr/bin/env node
/**
 * Builds a standalone Trapline executable using Node's official
 * Single Executable Application (SEA) support:
 *
 *   1. vite-build the web UI (sourcemaps off)
 *   2. esbuild-bundle the server to one CJS file
 *   3. generate a SEA config embedding the web UI as assets
 *   4. produce the SEA blob (platform-independent: no snapshot/code cache)
 *   5. copy the running node binary — or, for cross-targets, download the
 *      official nodejs.org build (checksum-verified) and extract it
 *   6. inject the blob with postject (macOS: codesign dance around it)
 *
 * Usage: node scripts/build-sea.mjs [--target <t>] [--skip-web] [--keep-work]
 *   targets: linux-x64 linux-arm64 macos-x64 macos-arm64 windows-x64
 *            (default: the host platform/arch)
 *
 * Trapline — community ISP service-quality monitor.
 * Copyright (C) 2026 l-small-tech
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(ROOT, 'build', 'sea');
const OUT_DIR = path.join(ROOT, 'dist');

const TARGETS = {
  'linux-x64': { platform: 'linux', arch: 'x64', node: 'linux-x64', ext: 'tar.gz' },
  'linux-arm64': { platform: 'linux', arch: 'arm64', node: 'linux-arm64', ext: 'tar.gz' },
  'macos-x64': { platform: 'darwin', arch: 'x64', node: 'darwin-x64', ext: 'tar.gz' },
  'macos-arm64': { platform: 'darwin', arch: 'arm64', node: 'darwin-arm64', ext: 'tar.gz' },
  'windows-x64': { platform: 'win32', arch: 'x64', node: 'win-x64', ext: 'zip' },
};

function hostTarget() {
  const key = Object.keys(TARGETS).find(
    (k) => TARGETS[k].platform === process.platform && TARGETS[k].arch === process.arch,
  );
  if (!key) throw new Error(`unsupported host: ${process.platform}-${process.arch}`);
  return key;
}

function parseArgs(argv) {
  const opts = { target: hostTarget(), skipWeb: false, keepWork: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') {
      opts.target = argv[++i];
      if (!TARGETS[opts.target]) throw new Error(`unknown target ${opts.target}; valid: ${Object.keys(TARGETS).join(' ')}`);
    } else if (argv[i] === '--skip-web') opts.skipWeb = true;
    else if (argv[i] === '--keep-work') opts.keepWork = true;
    else throw new Error(`unknown option ${argv[i]}`);
  }
  return opts;
}

function run(cmd, args, opts = {}) {
  console.log(`  $ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function walk(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, base));
    else files.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return files;
}

async function download(url) {
  console.log(`  fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Official node binary for a cross-target, checksum-verified against SHASUMS256.txt. */
async function fetchNodeBinary(target, destPath) {
  const v = process.versions.node; // pin to the running node so all targets match
  const t = TARGETS[target];
  const name = `node-v${v}-${t.node}`;
  const archive = `${name}.${t.ext}`;
  const base = `https://nodejs.org/dist/v${v}`;

  const sums = (await download(`${base}/SHASUMS256.txt`)).toString();
  const wanted = sums.split('\n').find((l) => l.trim().endsWith(archive))?.split(/\s+/)[0];
  if (!wanted) throw new Error(`${archive} not in SHASUMS256.txt`);

  const buf = await download(`${base}/${archive}`);
  const got = sha256(buf);
  if (got !== wanted) throw new Error(`checksum mismatch for ${archive}: ${got} != ${wanted}`);
  console.log(`  checksum ok: ${got.slice(0, 16)}…`);

  const scratch = path.join(tmpdir(), `trapline-node-${name}`);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const archivePath = path.join(scratch, archive);
  writeFileSync(archivePath, buf);

  if (t.ext === 'zip') {
    run('unzip', ['-q', archivePath, `${name}/node.exe`, '-d', scratch]);
    copyFileSync(path.join(scratch, name, 'node.exe'), destPath);
  } else {
    run('tar', ['-xf', archivePath, '-C', scratch, `${name}/bin/node`]);
    copyFileSync(path.join(scratch, name, 'bin', 'node'), destPath);
  }
  rmSync(scratch, { recursive: true, force: true });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const t = TARGETS[opts.target];
  const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const isHost = t.platform === process.platform && t.arch === process.arch;
  const outName = `trapline-v${version}-${opts.target}${t.platform === 'win32' ? '.exe' : ''}`;
  const outPath = path.join(OUT_DIR, outName);
  console.log(`building ${outName} (node v${process.versions.node}, ${isHost ? 'host' : 'cross'} target)`);

  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  // 1. web UI
  if (!opts.skipWeb) {
    console.log('▸ building web UI');
    // npm is npm.cmd on Windows, and Node refuses to spawn .cmd files
    // without a shell (CVE-2024-27980). Args are fixed strings — safe.
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build', '-w', 'web'], {
      env: { ...process.env, TRAPLINE_RELEASE: '1' },
      shell: process.platform === 'win32',
    });
  }
  const webDist = path.join(ROOT, 'web', 'dist');
  if (!existsSync(path.join(webDist, 'index.html'))) {
    throw new Error('web/dist/index.html missing — build the web UI first (or drop --skip-web)');
  }

  // 2. server bundle
  console.log('▸ bundling server (esbuild)');
  const esbuild = await import('esbuild');
  const bundlePath = path.join(ROOT, 'server', 'dist', 'server.cjs');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'server', 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    outfile: bundlePath,
    sourcemap: false,
    minify: false,
    legalComments: 'inline',
    define: {
      __APP_VERSION__: JSON.stringify(version),
      'import.meta.url': '__trapline_import_meta_url',
    },
    banner: {
      js: 'const __trapline_import_meta_url = require("node:url").pathToFileURL(__filename).href;',
    },
    logLevel: 'warning',
  });

  // 3. SEA config with the web UI as embedded assets
  console.log('▸ generating SEA config');
  const webFiles = walk(webDist).filter((f) => !f.endsWith('.map'));
  const assets = { 'web-manifest.json': path.join(WORK, 'web-manifest.json') };
  for (const f of webFiles) assets[`web/${f}`] = path.join(webDist, f.split('/').join(path.sep));
  writeFileSync(path.join(WORK, 'web-manifest.json'), JSON.stringify(webFiles.map((f) => `web/${f}`)));
  const seaConfig = {
    main: path.relative(ROOT, bundlePath).split(path.sep).join('/'),
    output: 'build/sea/trapline.blob',
    disableExperimentalSEAWarning: true,
    useSnapshot: false, // keep the blob platform-independent
    useCodeCache: false,
    assets,
  };
  writeFileSync(path.join(WORK, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));

  // 4. blob
  console.log('▸ generating SEA blob');
  run(process.execPath, ['--experimental-sea-config', 'build/sea/sea-config.json']);
  const blob = readFileSync(path.join(WORK, 'trapline.blob'));

  // 5. node binary
  console.log('▸ acquiring node binary');
  rmSync(outPath, { force: true });
  if (isHost) copyFileSync(process.execPath, outPath);
  else await fetchNodeBinary(opts.target, outPath);

  // 6. inject (macOS must shed the original signature first, then re-sign)
  if (t.platform === 'darwin' && process.platform === 'darwin') {
    run('codesign', ['--remove-signature', outPath]);
  }
  console.log('▸ injecting blob (postject)');
  const { inject } = await import('postject');
  await inject(outPath, 'NODE_SEA_BLOB', blob, {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(t.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
  });
  if (t.platform === 'darwin' && process.platform === 'darwin') {
    run('codesign', ['--sign', '-', outPath]); // ad-hoc signature
    run('codesign', ['--verify', outPath]);
  }
  if (t.platform !== 'win32') chmodSync(outPath, 0o755);

  if (!opts.keepWork) rmSync(WORK, { recursive: true, force: true });

  const size = statSync(outPath).size;
  const digest = sha256(readFileSync(outPath));
  console.log(`✓ ${path.relative(ROOT, outPath)}  ${(size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  sha256: ${digest}`);
}

main().catch((err) => {
  console.error('build failed:', err.message ?? err);
  process.exit(1);
});
