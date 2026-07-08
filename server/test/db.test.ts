/**
 * Smoke test for the node:sqlite adapter: open → migrate → real reads/writes
 * through Repo, including the .changes / lastInsertRowid coercion and the
 * manual BEGIN/COMMIT/ROLLBACK transaction helper.
 *
 * db.ts holds a module-level singleton, so everything runs in one file
 * against a single in-memory database.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDb, openDb } from '../src/db/db.js';
import { migrate } from '../src/db/migrations.js';
import { Repo } from '../src/db/repo.js';

test('node:sqlite adapter end-to-end', async (t) => {
  const db = openDb(':memory:');
  migrate(db);
  const repo = new Repo(db);

  await t.test('migrations are idempotent', () => {
    migrate(db); // second run must be a no-op, not an error
  });

  await t.test('targets round-trip with numeric ids', () => {
    const target = repo.upsertTarget('gateway', '192.168.1.1', 'Router', true);
    assert.equal(typeof target.id, 'number');
    const listed = repo.listTargets();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.host, '192.168.1.1');
  });

  await t.test('ping samples insert, read back, and purge reports changes', () => {
    const target = repo.listTargets()[0]!;
    repo.insertPing(1_000, target.id, 12.5);
    repo.insertPing(2_000, target.id, null); // a loss
    const samples = repo.getPingSamples(0, 3_000, target.id);
    assert.equal(samples.length, 2);
    assert.equal(samples[0]!.rttMs, 12.5);
    assert.equal(samples[1]!.rttMs, null);

    const purged = repo.purgeOldSamples(1_500, 0);
    assert.equal(purged.pings, 1);
    assert.equal(typeof purged.pings, 'number');
  });

  await t.test('settings merge over defaults', () => {
    const s = repo.getSettings();
    s.latencyThresholdMs = 99;
    repo.saveSettings(s);
    assert.equal(repo.getSettings().latencyThresholdMs, 99);
  });

  await t.test('transaction rolls back on throw', () => {
    const before = repo.listTargets().length;
    assert.throws(() =>
      repo.transaction(() => {
        repo.upsertTarget('anchor', '9.9.9.9', 'Quad9', false);
        throw new Error('boom');
      }),
    );
    assert.equal(repo.listTargets().length, before);
    // and the connection is still usable afterwards
    repo.upsertTarget('anchor', '1.1.1.1', 'Cloudflare', false);
    assert.equal(repo.listTargets().length, before + 1);
  });

  await t.test('vacuum + close do not throw', () => {
    repo.vacuumIncremental();
    closeDb();
  });
});
