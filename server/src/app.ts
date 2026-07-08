/**
 * Trapline server bootstrap: open DB → migrate → wire monitor components →
 * start Fastify on 127.0.0.1:8731. The server also serves the built web UI
 * (from web/dist, or embedded assets in the standalone executable) so the
 * app works without nginx.
 *
 * Trapline — community ISP service-quality monitor.
 * Copyright (C) 2026 l-small-tech
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 */
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import fs from 'node:fs';
import { registerRoutes } from './api/routes.js';
import { SseHub } from './api/sse.js';
import { BASE_PATH, DATA_DIR, HOST, PORT, VERSION, WEB_DIST } from './config.js';
import { closeDb, openDb } from './db/db.js';
import { migrate } from './db/migrations.js';
import { Repo } from './db/repo.js';
import { EvidenceCollector } from './monitor/evidence.js';
import { RollupJob } from './monitor/rollup.js';
import { Scheduler } from './monitor/scheduler.js';
import { UsageLedger } from './monitor/usage.js';
import { mtrSelfTest } from './probes/mtr.js';
import { isSea } from './sea.js';
import { SpeedTestEngine } from './speedtest/engine.js';
import { createPrettyStream } from './util/prettyLog.js';

function mtrHint(): string {
  switch (process.platform) {
    case 'darwin':
      return 'Fix: brew install mtr, then give mtr-packet raw-socket rights ' +
        '(sudo chown root "$(which mtr-packet)" && sudo chmod u+s "$(which mtr-packet)"). ' +
        'Trapline falls back to traceroute for target discovery.';
    case 'win32':
      return 'mtr does not exist on Windows — route evidence is disabled; ' +
        'Trapline uses tracert for target discovery instead.';
    default:
      return 'Fix: sudo apt install mtr-tiny (and ensure mtr-packet has cap_net_raw). ' +
        'Trapline falls back to traceroute for target discovery.';
  }
}

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

export async function startServer(): Promise<RunningServer> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      stream: process.stdout.isTTY ? createPrettyStream(process.stdout) : process.stdout,
    },
  });
  const log = (msg: string): void => app.log.info(msg);

  const db = openDb();
  migrate(db);
  const repo = new Repo(db);

  const hub = new SseHub();
  const usage = new UsageLedger(repo);
  const evidence = new EvidenceCollector(
    repo,
    usage,
    () => repo.getSettings().mode,
    () => repo.listTargets().filter((t) => t.enabled),
    log,
  );
  const speedEngine = new SpeedTestEngine(repo, usage, hub, log);
  const scheduler = new Scheduler(repo, usage, evidence, speedEngine, hub, log);
  const rollup = new RollupJob(repo, log);

  // mtr capability self-test (raw sockets); degrade gracefully if missing.
  const mtrTest = await mtrSelfTest();
  evidence.mtrAvailable = mtrTest.available;
  if (!mtrTest.available) {
    app.log.warn(`mtr is unavailable (${mtrTest.error ?? 'unknown'}); route evidence disabled. ${mtrHint()}`);
  }

  // API under /trapline/api.
  await app.register(async (api) => registerRoutes(api, { repo, scheduler, speedEngine, usage, hub }), {
    prefix: `${BASE_PATH}/api`,
  });

  if (isSea()) {
    // Standalone executable: web UI is embedded in the binary.
    const { registerEmbeddedStatic } = await import('./api/embeddedStatic.js');
    await registerEmbeddedStatic(app, BASE_PATH);
  } else if (fs.existsSync(WEB_DIST)) {
    // Static web UI (if built) under /trapline/, with SPA fallback.
    await app.register(fastifyStatic, {
      root: WEB_DIST,
      prefix: `${BASE_PATH}/`,
      index: ['index.html'],
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && req.url.startsWith(`${BASE_PATH}/`) && !req.url.startsWith(`${BASE_PATH}/api/`)) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not found' });
    });
  } else {
    app.log.warn(`web UI not built (${WEB_DIST} missing) — API only. Run: npm run build:web`);
  }

  app.get('/', async (_req, reply) => reply.redirect(`${BASE_PATH}/`));
  app.get(BASE_PATH, async (_req, reply) => reply.redirect(`${BASE_PATH}/`));

  usage.start();
  rollup.start();
  await scheduler.start();

  const shutdown = (signal: string): void => {
    app.log.info(`${signal} received — shutting down`);
    scheduler.stop();
    rollup.stop();
    usage.stop();
    hub.close();
    void app.close().then(() => {
      closeDb();
      process.exit(0);
    });
    // Belt and braces: never hang shutdown.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ host: HOST, port: PORT });
  const url = `http://${HOST}:${PORT}${BASE_PATH}/`;
  app.log.info(`Trapline v${VERSION} listening on ${url} (data: ${DATA_DIR})`);

  return {
    url,
    close: async () => {
      await app.close();
      closeDb();
    },
  };
}
