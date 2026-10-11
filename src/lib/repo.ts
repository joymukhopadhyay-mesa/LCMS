import { randomUUID } from "node:crypto";
import { exec, query, queryOne, tx } from "./db.ts";
import type {
  Band,
  CallRow,
  Channel,
  IncomingCall,
  IntegrationEvent,
  LeadFacts,
  PriceEdit,
  ScoreResult,
} from "./types.ts";

const nowIso = () => new Date().toISOString();

/** Last ten digits of a phone number, used to match a mid-call tool call to its call. */
export function phoneKey(p: string | null | undefined): string | null {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : null;
}

// ---------------------------------------------------------------- helpers

type Fields = Record<string, unknown>;

/**
 * UPDATE calls SET ... for the given fields.
 *   set   - overwrite
 *   soft  - overwrite only when the new value is not null (keeps what is already there)
 *   fill  - write only where the column is still null
 */
async function patch(id: string, set: Fields, opts: { soft?: Fields; fill?: Fields } = {}): Promise<void> {
  const params: unknown[] = [id];
  const parts: string[] = [];
  const add = (col: string, value: unknown, tpl: (i: number) => string) => {
    if (value === undefined) return;
    params.push(value);
    parts.push(`${col} = ${tpl(params.length)}`);
  };
  for (const [c, v] of Object.entries(set)) add(c, v, (i) => `$${i}`);
  for (const [c, v] of Object.entries(opts.soft ?? {})) add(c, v, (i) => `COALESCE($${i}, ${c})`);
  for (const [c, v] of Object.entries(opts.fill ?? {})) add(c, v, (i) => `COALESCE(${c}, $${i})`);
  if (!parts.length) return;
  await exec(`UPDATE calls SET ${parts.join(", ")} WHERE id = $1`, params);
}

// ---------------------------------------------------------------- calls

/** Insert a call. Idempotent on external_id: a retried delivery returns the existing row. */
export async function insertCall(c: IncomingCall): Promise<{ id: string; created: boolean }> {
  const id = randomUUID();
  const now = nowIso();
  const outcomeReceived = c.outcomeReceived ?? true;
  const transcriptReceived = c.transcriptReceived ?? Boolean(c.transcript);
  const row: Fields = {
    id,
    external_id: c.externalId,
    caller_name: c.callerName,
    caller_phone: c.callerPhone,
    caller_email: c.callerEmail,
    phone_key: phoneKey(c.callerPhone),
    received_at: c.receivedAt,
    duration_sec: c.durationSec,
    transcript: c.transcript,
    recording_url: c.recordingUrl,
    outcome: c.outcome,
    decline_reason: c.declineReason,
    gate_results: JSON.stringify(c.gateResults),
    open_questions: JSON.stringify(c.openQuestions),
    recovery_flag: c.recoveryFlag ? 1 : 0,
    language: c.language ?? null,
    volunteered_budget: c.volunteeredBudget ?? null,
    current_state: c.currentState ?? null,
    pricing_asked: c.pricingAsked ? 1 : 0,
    special_requests: c.specialRequests ?? null,
    locality: c.locality,
    property_type: c.propertyType,
    carpet_area: c.carpetArea,
    scope: c.scope,
    timeline: c.timeline,
    source: c.source,
    summary: c.summary,
    booking_start: c.bookingStart,
    booking_end: c.bookingEnd,
    booking_mode: c.bookingMode,
    booking_status: c.bookingStatus ?? null,
    vaani_analysis: c.vaaniAnalysis ?? null,
    outcome_received_at: outcomeReceived ? now : null,
    transcript_received_at: transcriptReceived ? now : null,
    // Gemini only ever sees calls Vaani forwarded (scoring logic: "never re-qualify").
    scoring_status: c.outcome === "FORWARD" ? "pending" : "not_applicable",
  };
  const cols = Object.keys(row);
  const inserted = await exec(
    `INSERT INTO calls (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (external_id) DO NOTHING`,
    Object.values(row),
  );
  if (inserted === 1) return { id, created: true };
  const existing = await queryOne<{ id: string }>("SELECT id FROM calls WHERE external_id = $1", [c.externalId]);
  return { id: existing!.id, created: false };
}

export async function getCall(id: string): Promise<CallRow | undefined> {
  return queryOne<CallRow>("SELECT * FROM calls WHERE id = $1", [id]);
}

export async function findByExternalId(externalId: string): Promise<CallRow | undefined> {
  return queryOne<CallRow>("SELECT * FROM calls WHERE external_id = $1", [externalId]);
}

/** Calls whose outcome record arrived but whose post-call transcript has not (newest first). */
export async function findAwaitingTranscript(sinceIso: string): Promise<CallRow[]> {
  return query<CallRow>(
    `SELECT * FROM calls WHERE outcome_received_at IS NOT NULL AND transcript_received_at IS NULL
       AND outcome_received_at > $1 ORDER BY outcome_received_at DESC`,
    [sinceIso],
  );
}

/** Calls whose transcript arrived but whose outcome record did not (newest first). */
export async function findAwaitingOutcome(sinceIso: string): Promise<CallRow[]> {
  return query<CallRow>(
    `SELECT * FROM calls WHERE transcript_received_at IS NOT NULL AND outcome_received_at IS NULL
       AND transcript_received_at > $1 ORDER BY transcript_received_at DESC`,
    [sinceIso],
  );
}

/** Merge Vaani's outcome record into an existing call. Descriptive fields never overwrite known values with blanks. */
export async function applyOutcome(id: string, c: IncomingCall): Promise<void> {
  await patch(
    id,
    {
      outcome: c.outcome,
      decline_reason: c.declineReason,
      gate_results: JSON.stringify(c.gateResults),
      open_questions: JSON.stringify(c.openQuestions),
      recovery_flag: c.recoveryFlag ? 1 : 0,
      pricing_asked: c.pricingAsked ? 1 : 0,
      booking_start: c.bookingStart,
      booking_end: c.bookingEnd,
      booking_mode: c.bookingMode,
      booking_status: c.bookingStatus ?? null,
      outcome_received_at: nowIso(),
      scoring_status: c.outcome === "FORWARD" ? "pending" : "not_applicable",
    },
    {
      soft: {
        caller_name: c.callerName,
        caller_phone: c.callerPhone,
        phone_key: phoneKey(c.callerPhone),
        language: c.language ?? null,
        volunteered_budget: c.volunteeredBudget ?? null,
        current_state: c.currentState ?? null,
        special_requests: c.specialRequests ?? null,
        locality: c.locality,
        property_type: c.propertyType,
        carpet_area: c.carpetArea,
        scope: c.scope,
        timeline: c.timeline,
        source: c.source,
        summary: c.summary,
      },
    },
  );
}

/** Attach Vaani's post-call transcript, recording and summary to a call. */
export async function applyTranscript(
  id: string,
  t: {
    externalId?: string;
    transcript: string;
    durationSec: number | null;
    recordingUrl: string | null;
    summary: string | null;
    receivedAt?: string | null;
    analysis: string | null;
    callerName?: string | null;
  },
): Promise<void> {
  await patch(
    id,
    {
      transcript: t.transcript,
      transcript_received_at: nowIso(),
      ...(t.externalId ? { external_id: t.externalId } : {}),
      ...(t.receivedAt ? { received_at: t.receivedAt } : {}),
    },
    {
      soft: { duration_sec: t.durationSec, recording_url: t.recordingUrl, vaani_analysis: t.analysis },
      fill: { summary: t.summary, caller_name: t.callerName ?? null },
    },
  );
}

/** First caller to claim the pipeline runs it; a retried webhook or the other half of Vaani's two messages gets false. */
export async function claimPipeline(id: string): Promise<boolean> {
  return (await exec("UPDATE calls SET pipeline_started_at = $2 WHERE id = $1 AND pipeline_started_at IS NULL", [id, nowIso()])) === 1;
}

export type ListFilter = {
  view?: "leads" | "all" | "not_qualified";
  band?: Band | "UNSCORED" | null;
  pricingDue?: boolean;
  q?: string | null;
};

export async function listCalls(f: ListFilter = {}): Promise<CallRow[]> {
  const where: string[] = [];
  const p: unknown[] = [];
  if (f.view === "leads") where.push("outcome = 'FORWARD'");
  if (f.view === "not_qualified") where.push("outcome <> 'FORWARD'");
  if (f.band === "UNSCORED") where.push("band IS NULL");
  else if (f.band) {
    p.push(f.band);
    where.push(`band = $${p.length}`);
  }
  if (f.pricingDue) where.push("(outcome = 'FORWARD' AND price_min_lakh IS NULL AND COALESCE(band,'') <> 'ESCALATE')");
  if (f.q) {
    p.push(`%${f.q}%`);
    const n = `$${p.length}`;
    where.push(
      `(caller_name ILIKE ${n} OR locality ILIKE ${n} OR caller_phone ILIKE ${n} OR brief ILIKE ${n} OR summary ILIKE ${n} OR external_id ILIKE ${n})`,
    );
  }
  return query<CallRow>(
    `SELECT * FROM calls ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY received_at DESC`,
    p,
  );
}

export async function saveScore(id: string, score: ScoreResult, facts: LeadFacts | null, usage: { input: number; output: number }) {
  // Vaani's own record wins; Gemini fills the gaps.
  await exec(
    `UPDATE calls SET
       band = $2, score_total = $3, readiness = $4, value_score = $5, confidence = $6,
       routing = $7, one_line = $8, scoring_json = $9, scoring_status = 'scored',
       scoring_error = NULL, scored_at = $10,
       gemini_input_tokens = gemini_input_tokens + $11, gemini_output_tokens = gemini_output_tokens + $12,
       caller_name = COALESCE(caller_name, $13), locality = COALESCE(locality, $14),
       property_type = COALESCE(property_type, $15), carpet_area = COALESCE(carpet_area, $16),
       scope = COALESCE(scope, $17), timeline = COALESCE(timeline, $18),
       source = COALESCE(source, $19), brief = COALESCE($20, brief)
     WHERE id = $1`,
    [
      id,
      score.band,
      score.total,
      score.readiness.score,
      score.value.score,
      score.confidence,
      score.routing,
      score.one_line_for_designer,
      JSON.stringify(score),
      nowIso(),
      usage.input,
      usage.output,
      facts?.caller_name ?? null,
      facts?.locality ?? null,
      facts?.property_type ?? null,
      facts?.carpet_area ?? null,
      facts?.scope ?? null,
      facts?.timeline ?? null,
      facts?.source ?? null,
      facts?.brief || null,
    ],
  );
}

export async function markScoringFailed(id: string, error: string, usage = { input: 0, output: 0 }) {
  await exec(
    `UPDATE calls SET scoring_status = 'failed', scoring_error = $2,
       gemini_input_tokens = gemini_input_tokens + $3, gemini_output_tokens = gemini_output_tokens + $4
     WHERE id = $1`,
    [id, error.slice(0, 2000), usage.input, usage.output],
  );
}

export async function setHubspotContact(id: string, contactId: string) {
  await exec("UPDATE calls SET hubspot_contact_id = $2 WHERE id = $1", [id, contactId]);
}

// ---------------------------------------------------------------- slot holds

export type SlotHold = {
  hold_key: string;
  start_at: string;
  end_at: string;
  mode: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  created_at?: string;
};

const HOLD_TTL_MS = 6 * 3600_000;

/** Booked consultation windows (and recent unconsumed holds) overlapping [from, to), used to avoid double-booking. */
export async function bookedWindows(fromIso: string, toIso: string): Promise<{ start: string; end: string }[]> {
  return query<{ start: string; end: string }>(
    `SELECT booking_start AS start, booking_end AS "end" FROM calls
       WHERE booking_start IS NOT NULL AND booking_start < $2 AND booking_end > $1
     UNION ALL
     SELECT start_at, end_at FROM slot_holds
       WHERE start_at < $2 AND end_at > $1 AND created_at > $3`,
    [fromIso, toIso, new Date(Date.now() - HOLD_TTL_MS).toISOString()],
  );
}

export const holdKey = (phone: string | null | undefined, callId?: string | null) =>
  phoneKey(phone) ?? (callId ? `call:${callId}` : null);

/** Hold a slot for a live call. Re-booking on the same key moves the hold. */
export async function holdSlot(h: SlotHold) {
  await exec(
    `INSERT INTO slot_holds (hold_key, start_at, end_at, mode, caller_name, caller_phone)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (hold_key) DO UPDATE SET start_at = $2, end_at = $3, mode = $4,
       caller_name = COALESCE($5, slot_holds.caller_name), caller_phone = COALESCE($6, slot_holds.caller_phone),
       created_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    [h.hold_key, h.start_at, h.end_at, h.mode, h.caller_name, h.caller_phone],
  );
}

export async function getHold(key: string): Promise<SlotHold | undefined> {
  return queryOne<SlotHold>("SELECT * FROM slot_holds WHERE hold_key = $1 AND created_at > $2", [
    key,
    new Date(Date.now() - HOLD_TTL_MS).toISOString(),
  ]);
}

/** Take a hold out of the table; its slot now lives on the lead. */
export async function consumeHold(key: string): Promise<SlotHold | undefined> {
  const rows = await query<SlotHold>("DELETE FROM slot_holds WHERE hold_key = $1 RETURNING *", [key]);
  const h = rows[0];
  return h && (h.created_at ?? "") > new Date(Date.now() - HOLD_TTL_MS).toISOString() ? h : undefined;
}

// ---------------------------------------------------------------- call sessions

export async function upsertSession(callId: string, phone: string | null) {
  await exec(
    `INSERT INTO call_sessions (call_id, phone, phone_key) VALUES ($1, $2, $3)
     ON CONFLICT (call_id) DO UPDATE SET phone = COALESCE($2, call_sessions.phone), phone_key = COALESCE($3, call_sessions.phone_key)`,
    [callId, phone, phoneKey(phone)],
  );
}

export async function getSession(callId: string): Promise<{ phone: string | null; phone_key: string | null } | undefined> {
  return queryOne("SELECT phone, phone_key FROM call_sessions WHERE call_id = $1", [callId]);
}

// ---------------------------------------------------------------- pricing

export async function updatePrice(input: {
  callId: string;
  minLakh: number;
  maxLakh: number;
  note: string | null;
  editedBy: string;
}): Promise<void> {
  await tx(async (q) => {
    const rows = await q<CallRow>("SELECT * FROM calls WHERE id = $1 FOR UPDATE", [input.callId]);
    const call = rows[0];
    if (!call) throw new Error("Lead not found");
    const now = nowIso();
    await q(
      `INSERT INTO price_edits (call_id, old_min_lakh, old_max_lakh, new_min_lakh, new_max_lakh, note, edited_by, edited_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [input.callId, call.price_min_lakh, call.price_max_lakh, input.minLakh, input.maxLakh, input.note, input.editedBy, now],
    );
    await q(
      `UPDATE calls SET price_min_lakh = $2, price_max_lakh = $3, price_note = $4, price_updated_at = $5 WHERE id = $1`,
      [input.callId, input.minLakh, input.maxLakh, input.note, now],
    );
  });
}

export async function listPriceEdits(callId: string): Promise<PriceEdit[]> {
  return query<PriceEdit>("SELECT * FROM price_edits WHERE call_id = $1 ORDER BY edited_at DESC, id DESC", [callId]);
}

// ---------------------------------------------------------------- integration log

export async function logEvent(
  callId: string,
  channel: Channel,
  status: IntegrationEvent["status"],
  detail: string | null,
  externalRef: string | null = null,
) {
  await exec(
    `INSERT INTO integration_events (call_id, channel, status, detail, external_ref) VALUES ($1, $2, $3, $4, $5)`,
    [callId, channel, status, detail?.slice(0, 2000) ?? null, externalRef],
  );
}

export async function listEvents(callId: string): Promise<IntegrationEvent[]> {
  return query<IntegrationEvent>("SELECT * FROM integration_events WHERE call_id = $1 ORDER BY created_at DESC, id DESC", [callId]);
}

/** Latest event per channel for a call. */
export async function latestEvents(callId: string): Promise<Partial<Record<Channel, IntegrationEvent>>> {
  const out: Partial<Record<Channel, IntegrationEvent>> = {};
  for (const e of await listEvents(callId)) if (!out[e.channel]) out[e.channel] = e;
  return out;
}

export async function recentFailures(limit = 8): Promise<(IntegrationEvent & { caller_name: string | null })[]> {
  return query(
    `SELECT e.*, c.caller_name FROM integration_events e JOIN calls c ON c.id = e.call_id
     WHERE e.status = 'failed'
       AND e.id = (SELECT MAX(id) FROM integration_events WHERE call_id = e.call_id AND channel = e.channel)
     ORDER BY e.created_at DESC LIMIT $1`,
    [limit],
  );
}

// ---------------------------------------------------------------- metrics

export type Metrics = {
  totalCalls: number;
  qualified: number;
  notQualified: number;
  declined: number;
  deferred: number;
  escalated: number;
  callbacks: number;
  notEnquiries: number;
  hot: number;
  warm: number;
  cold: number;
  unscored: number;
  pricingDue: number;
  afterHours: number;
  booked: number;
  callSeconds: number;
  geminiInput: number;
  geminiOutput: number;
  scoredCount: number;
};

export async function metrics(): Promise<Metrics> {
  const m = await queryOne<Record<string, unknown>>(`
    SELECT
      COUNT(*)::int AS "totalCalls",
      COUNT(*) FILTER (WHERE outcome = 'FORWARD')::int AS qualified,
      COUNT(*) FILTER (WHERE outcome IN ('DECLINE','DEFER'))::int AS "notQualified",
      COUNT(*) FILTER (WHERE outcome = 'DECLINE')::int AS declined,
      COUNT(*) FILTER (WHERE outcome = 'DEFER')::int AS deferred,
      COUNT(*) FILTER (WHERE outcome = 'ESCALATE' OR band = 'ESCALATE')::int AS escalated,
      COUNT(*) FILTER (WHERE outcome = 'CALLBACK')::int AS callbacks,
      COUNT(*) FILTER (WHERE outcome = 'NOT_ENQUIRY')::int AS "notEnquiries",
      COUNT(*) FILTER (WHERE outcome = 'FORWARD' AND band = 'HOT')::int AS hot,
      COUNT(*) FILTER (WHERE outcome = 'FORWARD' AND band = 'WARM')::int AS warm,
      COUNT(*) FILTER (WHERE outcome = 'FORWARD' AND band = 'COLD')::int AS cold,
      COUNT(*) FILTER (WHERE outcome = 'FORWARD' AND band IS NULL)::int AS unscored,
      COUNT(*) FILTER (WHERE outcome = 'FORWARD' AND price_min_lakh IS NULL AND COALESCE(band,'') <> 'ESCALATE')::int AS "pricingDue",
      COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM (received_at::timestamptz AT TIME ZONE 'Asia/Kolkata')) NOT BETWEEN 10 AND 18)::int AS "afterHours",
      COUNT(*) FILTER (WHERE booking_start IS NOT NULL)::int AS booked,
      COALESCE(SUM(duration_sec), 0)::int AS "callSeconds",
      COALESCE(SUM(gemini_input_tokens), 0)::bigint AS "geminiInput",
      COALESCE(SUM(gemini_output_tokens), 0)::bigint AS "geminiOutput",
      COUNT(*) FILTER (WHERE scoring_status = 'scored')::int AS "scoredCount"
    FROM calls`);
  return Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, Number(v ?? 0)])) as Metrics;
}

/** Front desk covers 10am-7pm IST (case brief). */
export function isAfterHours(iso: string): boolean {
  const d = new Date(iso);
  const istMinutes = (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440;
  return istMinutes < 10 * 60 || istMinutes >= 19 * 60;
}

export async function declineReasons(): Promise<{ reason: string; n: number }[]> {
  return query<{ reason: string; n: number }>(
    `SELECT COALESCE(decline_reason, outcome) AS reason, COUNT(*)::int AS n FROM calls
     WHERE outcome IN ('DECLINE','DEFER') GROUP BY 1 ORDER BY n DESC`,
  );
}

export async function resetDatabase() {
  await exec("TRUNCATE integration_events, price_edits, slot_holds, call_sessions, calls RESTART IDENTITY CASCADE");
}
