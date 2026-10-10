import { randomUUID } from "node:crypto";
import { db, tx } from "./db.ts";
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

type Params = Record<string, string | number | null>;

function all<T>(sql: string, params: Params = {}): T[] {
  return db().prepare(sql).all(params) as unknown as T[];
}
function one<T>(sql: string, params: Params = {}): T | undefined {
  return db().prepare(sql).get(params) as unknown as T | undefined;
}
function run(sql: string, params: Params = {}) {
  return db().prepare(sql).run(params);
}

// ---------------------------------------------------------------- calls

/** Insert a call from Vaani. Idempotent on Vaani's call id: a retried webhook returns the existing row. */
export function insertCall(c: IncomingCall): { id: string; created: boolean } {
  const existing = one<{ id: string }>("SELECT id FROM calls WHERE external_id = $ext", { $ext: c.externalId });
  if (existing) return { id: existing.id, created: false };

  const id = randomUUID();
  run(
    `INSERT INTO calls (id, external_id, caller_name, caller_phone, caller_email, received_at, duration_sec,
       transcript, recording_url, outcome, decline_reason, gate_results, open_questions, recovery_flag,
       locality, property_type, carpet_area, scope, timeline, source, summary,
       booking_start, booking_end, booking_mode, scoring_status)
     VALUES ($id, $ext, $name, $phone, $email, $received, $duration,
       $transcript, $recording, $outcome, $decline, $gates, $questions, $recovery,
       $locality, $ptype, $area, $scope, $timeline, $source, $summary,
       $bstart, $bend, $bmode, $scoring)`,
    {
      $id: id,
      $ext: c.externalId,
      $name: c.callerName,
      $phone: c.callerPhone,
      $email: c.callerEmail,
      $received: c.receivedAt,
      $duration: c.durationSec,
      $transcript: c.transcript,
      $recording: c.recordingUrl,
      $outcome: c.outcome,
      $decline: c.declineReason,
      $gates: JSON.stringify(c.gateResults),
      $questions: JSON.stringify(c.openQuestions),
      $recovery: c.recoveryFlag ? 1 : 0,
      $locality: c.locality,
      $ptype: c.propertyType,
      $area: c.carpetArea,
      $scope: c.scope,
      $timeline: c.timeline,
      $source: c.source,
      $summary: c.summary,
      $bstart: c.bookingStart,
      $bend: c.bookingEnd,
      $bmode: c.bookingMode,
      // Gemini only ever sees calls Vaani forwarded (scoring logic: "never re-qualify").
      $scoring: c.outcome === "FORWARD" ? "pending" : "not_applicable",
    },
  );
  return { id, created: true };
}

export function getCall(id: string): CallRow | undefined {
  return one<CallRow>("SELECT * FROM calls WHERE id = $id", { $id: id });
}

export type ListFilter = {
  view?: "leads" | "all" | "not_qualified";
  band?: Band | "UNSCORED" | null;
  pricingDue?: boolean;
  q?: string | null;
};

export function listCalls(f: ListFilter = {}): CallRow[] {
  const where: string[] = [];
  const p: Params = {};
  if (f.view === "leads") where.push("outcome = 'FORWARD'");
  if (f.view === "not_qualified") where.push("outcome <> 'FORWARD'");
  if (f.band === "UNSCORED") where.push("band IS NULL");
  else if (f.band) {
    where.push("band = $band");
    p.$band = f.band;
  }
  if (f.pricingDue) where.push("outcome = 'FORWARD' AND price_min_lakh IS NULL AND COALESCE(band,'') <> 'ESCALATE'");
  if (f.q) {
    where.push(
      "(caller_name LIKE $q OR locality LIKE $q OR caller_phone LIKE $q OR brief LIKE $q OR summary LIKE $q OR external_id LIKE $q)",
    );
    p.$q = `%${f.q}%`;
  }
  const sql = `SELECT * FROM calls ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY received_at DESC`;
  return all<CallRow>(sql, p);
}

export function saveScore(id: string, score: ScoreResult, facts: LeadFacts | null, usage: { input: number; output: number }) {
  const call = getCall(id);
  if (!call) throw new Error(`call ${id} not found`);
  // Vaani's own extraction wins; Gemini fills the gaps.
  run(
    `UPDATE calls SET
       band = $band, score_total = $total, readiness = $r, value_score = $v, confidence = $conf,
       routing = $routing, one_line = $line, scoring_json = $json, scoring_status = 'scored',
       scoring_error = NULL, scored_at = $now,
       gemini_input_tokens = gemini_input_tokens + $in, gemini_output_tokens = gemini_output_tokens + $out,
       caller_name = COALESCE(caller_name, $name), locality = COALESCE(locality, $locality),
       property_type = COALESCE(property_type, $ptype), carpet_area = COALESCE(carpet_area, $area),
       scope = COALESCE(scope, $scope), timeline = COALESCE(timeline, $timeline),
       source = COALESCE(source, $source), brief = COALESCE($brief, brief)
     WHERE id = $id`,
    {
      $id: id,
      $band: score.band,
      $total: score.total,
      $r: score.readiness.score,
      $v: score.value.score,
      $conf: score.confidence,
      $routing: score.routing,
      $line: score.one_line_for_designer,
      $json: JSON.stringify(score),
      $now: new Date().toISOString(),
      $in: usage.input,
      $out: usage.output,
      $name: facts?.caller_name ?? null,
      $locality: facts?.locality ?? null,
      $ptype: facts?.property_type ?? null,
      $area: facts?.carpet_area ?? null,
      $scope: facts?.scope ?? null,
      $timeline: facts?.timeline ?? null,
      $source: facts?.source ?? null,
      $brief: facts?.brief ?? null,
    },
  );
}

export function markScoringFailed(id: string, error: string, usage = { input: 0, output: 0 }) {
  run(
    `UPDATE calls SET scoring_status = 'failed', scoring_error = $err,
       gemini_input_tokens = gemini_input_tokens + $in, gemini_output_tokens = gemini_output_tokens + $out
     WHERE id = $id`,
    { $id: id, $err: error.slice(0, 2000), $in: usage.input, $out: usage.output },
  );
}

export function setHubspotContact(id: string, contactId: string) {
  run("UPDATE calls SET hubspot_contact_id = $c WHERE id = $id", { $id: id, $c: contactId });
}

export function setBooking(id: string, start: string, end: string, mode: string) {
  run("UPDATE calls SET booking_start = $s, booking_end = $e, booking_mode = $m WHERE id = $id", {
    $id: id,
    $s: start,
    $e: end,
    $m: mode,
  });
}

/** Booked or held consultation windows overlapping [from, to), used to avoid double-booking slots. */
export function bookedWindows(fromIso: string, toIso: string): { start: string; end: string }[] {
  return all<{ start: string; end: string }>(
    `SELECT booking_start AS start, booking_end AS end FROM calls
       WHERE booking_start IS NOT NULL AND booking_start < $to AND booking_end > $from
     UNION ALL
     SELECT h.start_at, h.end_at FROM slot_holds h
       WHERE h.start_at < $to AND h.end_at > $from
         AND NOT EXISTS (SELECT 1 FROM calls c WHERE c.external_id = h.external_id AND c.booking_start IS NOT NULL)`,
    { $from: fromIso, $to: toIso },
  );
}

export type SlotHold = {
  external_id: string;
  start_at: string;
  end_at: string;
  mode: string | null;
  caller_name: string | null;
  caller_phone: string | null;
};

/** Hold a slot for a live call. Re-booking on the same call moves the hold. */
export function holdSlot(h: SlotHold) {
  run(
    `INSERT INTO slot_holds (external_id, start_at, end_at, mode, caller_name, caller_phone)
     VALUES ($ext, $s, $e, $m, $n, $p)
     ON CONFLICT(external_id) DO UPDATE SET start_at = $s, end_at = $e, mode = $m,
       caller_name = COALESCE($n, caller_name), caller_phone = COALESCE($p, caller_phone)`,
    { $ext: h.external_id, $s: h.start_at, $e: h.end_at, $m: h.mode, $n: h.caller_name, $p: h.caller_phone },
  );
}

export function getHold(externalId: string): SlotHold | undefined {
  return one<SlotHold>("SELECT * FROM slot_holds WHERE external_id = $ext", { $ext: externalId });
}

// ---------------------------------------------------------------- pricing

export function updatePrice(input: {
  callId: string;
  minLakh: number;
  maxLakh: number;
  note: string | null;
  editedBy: string;
}): void {
  tx(() => {
    const call = getCall(input.callId);
    if (!call) throw new Error("Lead not found");
    const now = new Date().toISOString();
    run(
      `INSERT INTO price_edits (call_id, old_min_lakh, old_max_lakh, new_min_lakh, new_max_lakh, note, edited_by, edited_at)
       VALUES ($id, $omin, $omax, $nmin, $nmax, $note, $by, $now)`,
      {
        $id: input.callId,
        $omin: call.price_min_lakh,
        $omax: call.price_max_lakh,
        $nmin: input.minLakh,
        $nmax: input.maxLakh,
        $note: input.note,
        $by: input.editedBy,
        $now: now,
      },
    );
    run(
      `UPDATE calls SET price_min_lakh = $min, price_max_lakh = $max, price_note = $note, price_updated_at = $now
       WHERE id = $id`,
      { $id: input.callId, $min: input.minLakh, $max: input.maxLakh, $note: input.note, $now: now },
    );
  });
}

export function listPriceEdits(callId: string): PriceEdit[] {
  return all<PriceEdit>("SELECT * FROM price_edits WHERE call_id = $id ORDER BY edited_at DESC, id DESC", { $id: callId });
}

// ---------------------------------------------------------------- integration log

export function logEvent(
  callId: string,
  channel: Channel,
  status: IntegrationEvent["status"],
  detail: string | null,
  externalRef: string | null = null,
) {
  run(
    `INSERT INTO integration_events (call_id, channel, status, detail, external_ref)
     VALUES ($id, $ch, $st, $detail, $ref)`,
    { $id: callId, $ch: channel, $st: status, $detail: detail?.slice(0, 2000) ?? null, $ref: externalRef },
  );
}

export function listEvents(callId: string): IntegrationEvent[] {
  return all<IntegrationEvent>(
    "SELECT * FROM integration_events WHERE call_id = $id ORDER BY created_at DESC, id DESC",
    { $id: callId },
  );
}

/** Latest event per channel for a call. */
export function latestEvents(callId: string): Partial<Record<Channel, IntegrationEvent>> {
  const out: Partial<Record<Channel, IntegrationEvent>> = {};
  for (const e of listEvents(callId)) if (!out[e.channel]) out[e.channel] = e;
  return out;
}

export function recentFailures(limit = 8): (IntegrationEvent & { caller_name: string | null })[] {
  return all(
    `SELECT e.*, c.caller_name FROM integration_events e JOIN calls c ON c.id = e.call_id
     WHERE e.status = 'failed'
       AND e.id = (SELECT MAX(id) FROM integration_events WHERE call_id = e.call_id AND channel = e.channel)
     ORDER BY e.created_at DESC LIMIT ${Number(limit)}`,
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

export function metrics(): Metrics {
  const m = one<Omit<Metrics, "afterHours">>(`
    SELECT
      COUNT(*) AS totalCalls,
      SUM(outcome = 'FORWARD') AS qualified,
      SUM(outcome IN ('DECLINE','DEFER')) AS notQualified,
      SUM(outcome = 'DECLINE') AS declined,
      SUM(outcome = 'DEFER') AS deferred,
      SUM(outcome = 'ESCALATE' OR band = 'ESCALATE') AS escalated,
      SUM(outcome = 'CALLBACK') AS callbacks,
      SUM(outcome = 'FORWARD' AND band = 'HOT') AS hot,
      SUM(outcome = 'FORWARD' AND band = 'WARM') AS warm,
      SUM(outcome = 'FORWARD' AND band = 'COLD') AS cold,
      SUM(outcome = 'FORWARD' AND band IS NULL) AS unscored,
      SUM(outcome = 'FORWARD' AND price_min_lakh IS NULL AND COALESCE(band,'') <> 'ESCALATE') AS pricingDue,
      SUM(booking_start IS NOT NULL) AS booked,
      COALESCE(SUM(duration_sec), 0) AS callSeconds,
      COALESCE(SUM(gemini_input_tokens), 0) AS geminiInput,
      COALESCE(SUM(gemini_output_tokens), 0) AS geminiOutput,
      SUM(scoring_status = 'scored') AS scoredCount
    FROM calls`)!;
  const times = all<{ received_at: string }>("SELECT received_at FROM calls");
  const afterHours = times.filter((t) => isAfterHours(t.received_at)).length;
  const n = (v: unknown) => Number(v ?? 0);
  return Object.fromEntries(
    Object.entries({ ...m, afterHours }).map(([k, v]) => [k, n(v)]),
  ) as Metrics;
}

/** Front desk covers 10am-7pm IST (case brief). */
export function isAfterHours(iso: string): boolean {
  const d = new Date(iso);
  const istMinutes = (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440;
  return istMinutes < 10 * 60 || istMinutes >= 19 * 60;
}

export function declineReasons(): { reason: string; n: number }[] {
  return all<{ reason: string; n: number }>(
    `SELECT COALESCE(decline_reason, outcome) AS reason, COUNT(*) AS n FROM calls
     WHERE outcome IN ('DECLINE','DEFER') GROUP BY 1 ORDER BY n DESC`,
  );
}

export function resetDatabase() {
  db().exec("DELETE FROM integration_events; DELETE FROM price_edits; DELETE FROM slot_holds; DELETE FROM calls;");
}
