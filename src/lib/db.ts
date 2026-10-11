import { Pool, type PoolClient, type QueryResultRow } from "pg";

// Postgres (Neon). The schema is created on first use, so a fresh branch or
// database works with no migration step. Timestamps are stored as ISO-8601 UTC
// text so they sort lexicographically and round-trip through JSON unchanged.

const ISO_NOW = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS calls (
  id                     TEXT PRIMARY KEY,
  external_id            TEXT NOT NULL UNIQUE,
  caller_name            TEXT,
  caller_phone           TEXT,
  caller_email           TEXT,
  phone_key              TEXT,
  received_at            TEXT NOT NULL,
  duration_sec           INTEGER,
  transcript             TEXT NOT NULL DEFAULT '',
  recording_url          TEXT,
  outcome                TEXT NOT NULL,
  decline_reason         TEXT,
  gate_results           TEXT NOT NULL DEFAULT '{}',
  open_questions         TEXT NOT NULL DEFAULT '[]',
  recovery_flag          INTEGER NOT NULL DEFAULT 0,
  language               TEXT,
  volunteered_budget     TEXT,
  current_state          TEXT,
  pricing_asked          INTEGER NOT NULL DEFAULT 0,
  special_requests       TEXT,
  locality               TEXT,
  property_type          TEXT,
  carpet_area            TEXT,
  scope                  TEXT,
  timeline               TEXT,
  source                 TEXT,
  summary                TEXT,
  brief                  TEXT,
  booking_start          TEXT,
  booking_end            TEXT,
  booking_mode           TEXT,
  booking_status         TEXT,
  vaani_analysis         TEXT,
  band                   TEXT,
  score_total            INTEGER,
  readiness              INTEGER,
  value_score            INTEGER,
  confidence             TEXT,
  routing                TEXT,
  one_line               TEXT,
  scoring_json           TEXT,
  scoring_status         TEXT NOT NULL DEFAULT 'pending',
  scoring_error          TEXT,
  scored_at              TEXT,
  gemini_input_tokens    INTEGER NOT NULL DEFAULT 0,
  gemini_output_tokens   INTEGER NOT NULL DEFAULT 0,
  price_min_lakh         DOUBLE PRECISION,
  price_max_lakh         DOUBLE PRECISION,
  price_note             TEXT,
  price_updated_at       TEXT,
  hubspot_contact_id     TEXT,
  outcome_received_at    TEXT,
  transcript_received_at TEXT,
  pipeline_started_at    TEXT,
  created_at             TEXT NOT NULL DEFAULT (${ISO_NOW})
);
CREATE INDEX IF NOT EXISTS idx_calls_received ON calls (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_booking ON calls (booking_start);
CREATE INDEX IF NOT EXISTS idx_calls_phone ON calls (phone_key);

CREATE TABLE IF NOT EXISTS price_edits (
  id            SERIAL PRIMARY KEY,
  call_id       TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  old_min_lakh  DOUBLE PRECISION,
  old_max_lakh  DOUBLE PRECISION,
  new_min_lakh  DOUBLE PRECISION NOT NULL,
  new_max_lakh  DOUBLE PRECISION NOT NULL,
  note          TEXT,
  edited_by     TEXT NOT NULL,
  edited_at     TEXT NOT NULL DEFAULT (${ISO_NOW})
);
CREATE INDEX IF NOT EXISTS idx_price_edits_call ON price_edits (call_id, edited_at DESC);

CREATE TABLE IF NOT EXISTS integration_events (
  id            SERIAL PRIMARY KEY,
  call_id       TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  channel       TEXT NOT NULL,
  status        TEXT NOT NULL,
  detail        TEXT,
  external_ref  TEXT,
  created_at    TEXT NOT NULL DEFAULT (${ISO_NOW})
);
CREATE INDEX IF NOT EXISTS idx_events_call ON integration_events (call_id, created_at DESC);

-- A slot Vaani holds mid-call, keyed by the caller's number (the tool calls carry no call id).
-- The outcome record consumes it into the lead's booking.
CREATE TABLE IF NOT EXISTS slot_holds (
  hold_key      TEXT PRIMARY KEY,
  start_at      TEXT NOT NULL,
  end_at        TEXT NOT NULL,
  mode          TEXT,
  caller_name   TEXT,
  caller_phone  TEXT,
  created_at    TEXT NOT NULL DEFAULT (${ISO_NOW})
);

-- call_started events carry the caller's number, which is how a post-call transcript finds its outcome record.
CREATE TABLE IF NOT EXISTS call_sessions (
  call_id     TEXT PRIMARY KEY,
  phone       TEXT,
  phone_key   TEXT,
  started_at  TEXT NOT NULL DEFAULT (${ISO_NOW})
);
`;

type G = { __lcmsPool?: Pool; __lcmsSchema?: Promise<void> };
const g = globalThis as unknown as G;

function connectionString(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  // pg treats sslmode=require as verify-full and warns; say so explicitly. channel_binding is not needed.
  const u = new URL(raw);
  u.searchParams.delete("channel_binding");
  if (u.searchParams.get("sslmode") === "require") u.searchParams.set("sslmode", "verify-full");
  return u.toString();
}

function pool(): Pool {
  if (!g.__lcmsPool) {
    const p = new Pool({ connectionString: connectionString(), max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 });
    p.on("error", (err) => console.error("[db] idle client error:", err.message));
    g.__lcmsPool = p;
  }
  return g.__lcmsPool;
}

async function ready(): Promise<Pool> {
  const p = pool();
  if (!g.__lcmsSchema) {
    g.__lcmsSchema = (async () => {
      const client = await p.connect();
      try {
        // Two cold starts creating tables at once can collide in the catalog; serialise them.
        await client.query("SELECT pg_advisory_lock(734201)");
        await client.query(SCHEMA);
        await client.query("SELECT pg_advisory_unlock(734201)");
      } finally {
        client.release();
      }
    })().catch((err) => {
      g.__lcmsSchema = undefined;
      throw err;
    });
  }
  await g.__lcmsSchema;
  return p;
}

export type Q = <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => Promise<T[]>;

export const query: Q = async (sql, params = []) => {
  const p = await ready();
  return (await p.query(sql, params as unknown[])).rows as never;
};

export async function queryOne<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(sql, params))[0];
}

/** Run a statement and return how many rows it changed. */
export async function exec(sql: string, params: unknown[] = []): Promise<number> {
  const p = await ready();
  return (await p.query(sql, params as unknown[])).rowCount ?? 0;
}

export async function tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  const p = await ready();
  const client: PoolClient = await p.connect();
  try {
    await client.query("BEGIN");
    const out = await fn((async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows) as Q);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Close the pool (scripts only; the server keeps it for the life of the process). */
export async function closeDb() {
  await g.__lcmsPool?.end();
  g.__lcmsPool = undefined;
  g.__lcmsSchema = undefined;
}
