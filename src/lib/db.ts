import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// One SQLite file, opened once per server process. The schema is created on
// first open so a fresh checkout works with no migration step.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS calls (
  id                   TEXT PRIMARY KEY,
  external_id          TEXT NOT NULL UNIQUE,
  caller_name          TEXT,
  caller_phone         TEXT,
  caller_email         TEXT,
  received_at          TEXT NOT NULL,
  duration_sec         INTEGER,
  transcript           TEXT NOT NULL DEFAULT '',
  recording_url        TEXT,
  outcome              TEXT NOT NULL,
  decline_reason       TEXT,
  gate_results         TEXT NOT NULL DEFAULT '{}',
  open_questions       TEXT NOT NULL DEFAULT '[]',
  recovery_flag        INTEGER NOT NULL DEFAULT 0,
  locality             TEXT,
  property_type        TEXT,
  carpet_area          TEXT,
  scope                TEXT,
  timeline             TEXT,
  source               TEXT,
  summary              TEXT,
  brief                TEXT,
  booking_start        TEXT,
  booking_end          TEXT,
  booking_mode         TEXT,
  band                 TEXT,
  score_total          INTEGER,
  readiness            INTEGER,
  value_score          INTEGER,
  confidence           TEXT,
  routing              TEXT,
  one_line             TEXT,
  scoring_json         TEXT,
  scoring_status       TEXT NOT NULL DEFAULT 'pending',
  scoring_error        TEXT,
  scored_at            TEXT,
  gemini_input_tokens  INTEGER NOT NULL DEFAULT 0,
  gemini_output_tokens INTEGER NOT NULL DEFAULT 0,
  price_min_lakh       REAL,
  price_max_lakh       REAL,
  price_note           TEXT,
  price_updated_at     TEXT,
  hubspot_contact_id   TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_calls_received ON calls(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_booking ON calls(booking_start);

CREATE TABLE IF NOT EXISTS price_edits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id       TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  old_min_lakh  REAL,
  old_max_lakh  REAL,
  new_min_lakh  REAL NOT NULL,
  new_max_lakh  REAL NOT NULL,
  note          TEXT,
  edited_by     TEXT NOT NULL,
  edited_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_price_edits_call ON price_edits(call_id, edited_at DESC);

CREATE TABLE IF NOT EXISTS integration_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id       TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL,
  status        TEXT NOT NULL,
  detail        TEXT,
  external_ref  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_call ON integration_events(call_id, created_at DESC);

-- Slots Vaani holds during a live call, before the post-call webhook creates the call row.
CREATE TABLE IF NOT EXISTS slot_holds (
  external_id   TEXT PRIMARY KEY,
  start_at      TEXT NOT NULL,
  end_at        TEXT NOT NULL,
  mode          TEXT,
  caller_name   TEXT,
  caller_phone  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

const globalForDb = globalThis as unknown as { __lcmsDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (globalForDb.__lcmsDb) return globalForDb.__lcmsDb;
  // Runtime location, not a build input - keep the bundler from tracing the whole project.
  const file = path.resolve(/*turbopackIgnore: true*/ process.env.DATABASE_PATH || "./data/lcms.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  conn.exec(SCHEMA);
  globalForDb.__lcmsDb = conn;
  return conn;
}

export function tx<T>(fn: () => T): T {
  const conn = db();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    conn.exec("COMMIT");
    return out;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}
