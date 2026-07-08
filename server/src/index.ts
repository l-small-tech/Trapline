/**
 * Trapline server bootstrap: open DB → migrate → wire monitor components →
 * start Fastify on 127.0.0.1:8731. The server also serves the built web UI
 * from web/dist so the app works standalone without nginx.
 */
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import fs from 'node:fs';
import { registerRoutes } from './api/routes.js';
import { SseHub } from './api/sse.js';
import { BASE_PATH, HOST, PORT, VERSION, WEB_DIST } from './config.js';
import { closeDb, openDb } from './db/db.js';
import { migrate } from './db/migrations.js';
import { Repo } from './db/repo.js';
import { EvidenceCollector } from './monitor/evidence.js';
import { RollupJob } from './monitor/rollup.js';
import { Scheduler } from './monitor/scheduler.js';
import { UsageLedger } from './monitor/usage.js';
import { mtrSelfTest } from './probes/mtr.js';
import { SpeedTestEngine } from './speedtest/engine.js';

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.stdout.isTTY
        ? { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } }
        : undefined,
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
    app.log.warn(
      `mtr is unavailable (${mtrTest.error ?? 'unknown'}); route evidence disabled. ` +
        'Fix: sudo apt install mtr-tiny (and ensure mtr-packet has cap_net_raw).',
    );
  }

  // API under /trapline/api.
  await app.register(async (api) => registerRoutes(api, { repo, scheduler, speedEngine, usage, hub }), {
    prefix: `${BASE_PATH}/api`,
  });

  // Static web UI (if built) under /trapline/, with SPA fallback.
  if (fs.existsSync(WEB_DIST)) {
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
  app.log.info(`Trapline v${VERSION} listening on http://${HOST}:${PORT}${BASE_PATH}/`);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
