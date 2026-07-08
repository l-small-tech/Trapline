import type { Db } from './db.js';

/**
 * Versioned, append-only migrations. Never edit an entry after it has
 * shipped — add a new one.
 */
const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE targets (
        id         INTEGER PRIMARY KEY,
        kind       TEXT NOT NULL CHECK (kind IN ('gateway','isp_hop','anchor','custom')),
        host       TEXT NOT NULL,
        label      TEXT NOT NULL,
        is_lan     INTEGER NOT NULL DEFAULT 0,
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX idx_targets_host ON targets(host);

      CREATE TABLE ping_samples (
        id        INTEGER PRIMARY KEY,
        ts        INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        rtt_ms    REAL,            -- NULL = lost
        success   INTEGER NOT NULL
      );
      CREATE INDEX idx_ping_target_ts ON ping_samples(target_id, ts);
      CREATE INDEX idx_ping_ts ON ping_samples(ts);

      CREATE TABLE dns_samples (
        id          INTEGER PRIMARY KEY,
        ts          INTEGER NOT NULL,
        resolver    TEXT NOT NULL,
        hostname    TEXT NOT NULL,
        duration_ms REAL,
        success     INTEGER NOT NULL,
        error       TEXT
      );
      CREATE INDEX idx_dns_ts ON dns_samples(ts);

      CREATE TABLE http_samples (
        id       INTEGER PRIMARY KEY,
        ts       INTEGER NOT NULL,
        url      TEXT NOT NULL,
        status   INTEGER,
        ttfb_ms  REAL,
        total_ms REAL,
        success  INTEGER NOT NULL,
        error    TEXT
      );
      CREATE INDEX idx_http_ts ON http_samples(ts);

      CREATE TABLE speed_tests (
        id                INTEGER PRIMARY KEY,
        ts                INTEGER NOT NULL,
        trigger_kind      TEXT NOT NULL CHECK (trigger_kind IN ('scheduled','manual')),
        down_bps          REAL,
        up_bps            REAL,
        idle_latency_ms   REAL,
        loaded_down_ms    REAL,
        loaded_up_ms      REAL,
        bufferbloat_grade TEXT,
        bytes_down        INTEGER NOT NULL DEFAULT 0,
        bytes_up          INTEGER NOT NULL DEFAULT 0,
        duration_ms       INTEGER NOT NULL DEFAULT 0,
        error             TEXT,
        detail            TEXT
      );
      CREATE INDEX idx_speed_ts ON speed_tests(ts);

      CREATE TABLE events (
        id             INTEGER PRIMARY KEY,
        kind           TEXT NOT NULL CHECK (kind IN
          ('outage','latency_spike','packet_loss','dns_failure','speed_degradation','monitor_gap')),
        severity       TEXT NOT NULL CHECK (severity IN ('info','minor','major','critical')),
        classification TEXT NOT NULL CHECK (classification IN ('isp','lan','upstream','unknown')),
        started_at     INTEGER NOT NULL,
        ended_at       INTEGER,        -- NULL = ongoing
        summary        TEXT NOT NULL,
        detail         TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_events_started ON events(started_at);

      CREATE TABLE event_evidence (
        id          INTEGER PRIMARY KEY,
        event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL CHECK (kind IN ('mtr','ping_window','dns_log','speed')),
        captured_at INTEGER NOT NULL,
        content     TEXT NOT NULL
      );
      CREATE INDEX idx_evidence_event ON event_evidence(event_id);

      CREATE TABLE ping_rollups_hourly (
        hour_start INTEGER NOT NULL,
        target_id  INTEGER NOT NULL,
        sent       INTEGER NOT NULL,
        lost       INTEGER NOT NULL,
        rtt_avg    REAL,
        rtt_min    REAL,
        rtt_max    REAL,
        rtt_p50    REAL,
        rtt_p95    REAL,
        rtt_p99    REAL,
        jitter_avg REAL,
        PRIMARY KEY (hour_start, target_id)
      );

      CREATE TABLE dns_rollups_hourly (
        hour_start INTEGER PRIMARY KEY,
        count      INTEGER NOT NULL,
        failures   INTEGER NOT NULL,
        p50        REAL,
        p95        REAL
      );

      CREATE TABLE http_rollups_hourly (
        hour_start INTEGER PRIMARY KEY,
        count      INTEGER NOT NULL,
        failures   INTEGER NOT NULL,
        ttfb_p50   REAL,
        ttfb_p95   REAL
      );

      CREATE TABLE data_usage_hourly (
        hour_start INTEGER NOT NULL,
        category   TEXT NOT NULL CHECK (category IN ('ping','dns','http','speedtest','mtr')),
        is_lan     INTEGER NOT NULL DEFAULT 0,
        bytes_sent INTEGER NOT NULL DEFAULT 0,
        bytes_recv INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (hour_start, category, is_lan)
      );
    `,
  },
  {
    // Add the 'high_latency' event kind. SQLite cannot alter a CHECK
    // constraint, so the events table is rebuilt (FKs are disabled around
    // migrations so event_evidence rows survive the drop/rename).
    version: 2,
    sql: `
      CREATE TABLE events_new (
        id             INTEGER PRIMARY KEY,
        kind           TEXT NOT NULL CHECK (kind IN
          ('outage','latency_spike','high_latency','packet_loss','dns_failure','speed_degradation','monitor_gap')),
        severity       TEXT NOT NULL CHECK (severity IN ('info','minor','major','critical')),
        classification TEXT NOT NULL CHECK (classification IN ('isp','lan','upstream','unknown')),
        started_at     INTEGER NOT NULL,
        ended_at       INTEGER,        -- NULL = ongoing
        summary        TEXT NOT NULL,
        detail         TEXT NOT NULL DEFAULT '{}'
      );
      INSERT INTO events_new SELECT id, kind, severity, classification, started_at, ended_at, summary, detail FROM events;
      DROP TABLE events;
      ALTER TABLE events_new RENAME TO events;
      CREATE INDEX idx_events_started ON events(started_at);
    `,
  },
];

export function migrate(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  // Table rebuilds must not cascade-delete referencing rows or fail FK
  // checks mid-migration (the standard SQLite alter-table procedure).
  db.pragma('foreign_keys = OFF');
  try {
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      db.transaction(() => {
        db.exec(m.sql);
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
          m.version,
          Date.now(),
        );
      })();
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
