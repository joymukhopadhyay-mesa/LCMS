import { GATE_KEYS, type GateResult, type GateResults, type GateVerdict, type IncomingCall, type Outcome } from "./types.ts";

// Everything Vaani sends us, normalised.
//
//  1. submit_call_outcome (tool call, mid-call): the structured record defined at the
//     end of the Vaani system prompt -> normaliseOutcomeRecord()
//  2. call_started webhook:  carries the caller's number -> normaliseSessionEvent()
//  3. call_postprocessing webhook: transcript, summary, recording, entities and
//     dispositions once the call is over -> normalisePostCall()
//
// Both are tolerant of small naming differences (camelCase, nesting) because the
// LLM fills in tool arguments and Vaani's payloads are documented loosely.

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function pick(sources: Obj[], ...keys: string[]): unknown {
  for (const src of sources) {
    for (const k of keys) {
      const v = src[k];
      if (v !== undefined && v !== null && v !== "") return v;
    }
  }
  return undefined;
}

const str = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const toBool = (v: unknown): boolean => v === true || v === 1 || /^(true|yes|1)$/i.test(String(v ?? ""));

function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return v.split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function toIso(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : NaN;
  const d = Number.isFinite(n) ? new Date(n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export class PayloadError extends Error {}

// ---------------------------------------------------------------- transcript

const TURN = /^\s*(?:\[[^\]]*\]\s*)?(AGENT|ASSISTANT|BOT|AI|VAANI|USER|CALLER|CUSTOMER|HUMAN)\s*:\s*([\s\S]*)$/i;

/** "[13:33:14] AGENT: Hi" / turn arrays -> "Vaani: Hi\nCaller: ..." */
export function convertTranscript(raw: unknown): string {
  const turns: string[] = [];
  const push = (role: string, text: string) => {
    const who = /^(agent|assistant|bot|ai|vaani)$/i.test(role) ? "Vaani" : "Caller";
    const t = text.replace(/\s+/g, " ").trim();
    if (t) turns.push(`${who}: ${t}`);
  };

  if (Array.isArray(raw)) {
    for (const t of raw) {
      if (typeof t === "string") {
        const m = t.match(TURN);
        if (m) push(m[1], m[2]);
      } else if (isObj(t)) {
        push(String(t.role ?? t.speaker ?? t.from ?? "user"), String(t.content ?? t.text ?? t.message ?? t.transcript ?? ""));
      }
    }
    return turns.join("\n");
  }
  if (typeof raw !== "string") return "";

  // Turns may be newline-separated or run together; split before each "[hh:mm:ss] ROLE:" marker.
  const chunks = raw.split(/(?=\[\d{1,2}:\d{2}(?::\d{2})?\]\s*(?:AGENT|ASSISTANT|BOT|AI|VAANI|USER|CALLER|CUSTOMER|HUMAN)\s*:)/i);
  for (const chunk of chunks.flatMap((c) => (/\[\d{1,2}:\d{2}/.test(c) ? [c] : c.split(/\r?\n/)))) {
    const m = chunk.match(TURN);
    if (m) push(m[1], m[2]);
    else if (turns.length && chunk.trim()) turns[turns.length - 1] += " " + chunk.trim();
  }
  return turns.join("\n");
}

// ---------------------------------------------------------------- outcome record (submit_call_outcome)

const OUTCOMES: Record<string, Outcome> = {
  forward: "FORWARD",
  forward_booking_pending: "FORWARD",
  defer: "DEFER",
  deferred: "DEFER",
  decline: "DECLINE",
  declined: "DECLINE",
  escalate: "ESCALATE",
  escalated: "ESCALATE",
  not_an_enquiry: "NOT_ENQUIRY",
  not_an_inquiry: "NOT_ENQUIRY",
  not_enquiry: "NOT_ENQUIRY",
  callback: "CALLBACK",
};

const VERDICTS: Record<string, GateVerdict> = {
  pass: "pass",
  pass_with_note: "pass-with-note",
  fail: "fail",
  unresolved: "unresolved",
  unclear: "unresolved",
  not_mentioned: "silent",
  silent: "silent",
};

function toGates(v: unknown, notes: unknown): GateResults {
  if (!isObj(v)) return {};
  const noteMap = isObj(notes) ? notes : {};
  const out: GateResults = {};
  for (const key of GATE_KEYS) {
    const raw = v[key];
    const verdictRaw = isObj(raw) ? raw.verdict ?? raw.result : raw;
    if (verdictRaw === undefined || verdictRaw === null) continue;
    const verdict = VERDICTS[String(verdictRaw).toLowerCase().replace(/[\s-]+/g, "_")] ?? "unresolved";
    const note = str(noteMap[key]) ?? (isObj(raw) ? str(raw.note) : null);
    const g: GateResult = { verdict };
    if (note) g.note = note;
    out[key] = g;
  }
  return out;
}

function carpet(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString("en-IN")} sq ft` : str(v);
}

export type OutcomeInput = { callId: string | null; call: IncomingCall };

export function normaliseOutcomeRecord(body: unknown): OutcomeInput {
  if (!isObj(body)) throw new PayloadError("Body must be a JSON object");
  const r = isObj(body.record) ? body.record : isObj(body.outcome_record) ? body.outcome_record : body;
  const caller = isObj(r.caller) ? r.caller : {};
  const project = isObj(r.project) ? r.project : {};
  const booking = isObj(r.booking) ? r.booking : {};

  const rawOutcome = str(r.outcome);
  const outcome = rawOutcome ? OUTCOMES[rawOutcome.toLowerCase().replace(/[\s-]+/g, "_")] : undefined;
  if (!outcome) {
    throw new PayloadError(
      `outcome must be one of: forward, forward_booking_pending, defer, decline, escalate, not_an_enquiry (got ${JSON.stringify(rawOutcome)})`,
    );
  }

  const referrer = str(caller.referrer_name);
  const how = str(caller.how_found_us);
  const source = referrer ? `Referral - ${referrer}${how ? ` (${how})` : ""}` : how;

  const slot = str(booking.slot);
  const start = slot ? toIso(slot) : null;
  const bookingStatus = str(booking.status)?.toLowerCase() ?? null;
  const confirmed = outcome === "FORWARD" && bookingStatus === "confirmed" && start;
  const topId = str(pick([body, r], "call_id", "callId", "room_name"));

  const call: IncomingCall = {
    externalId: topId ?? "",
    callerName: str(caller.name),
    callerPhone: str(caller.callback_number ?? caller.phone),
    callerEmail: str(caller.email),
    receivedAt: new Date().toISOString(),
    durationSec: null,
    transcript: "",
    recordingUrl: null,
    outcome,
    declineReason: str(r.decline_reason),
    gateResults: toGates(r.gate_results, r.gate_notes),
    openQuestions: toList(r.open_questions),
    recoveryFlag: toBool(r.recovery_flag),
    language: str(r.language),
    volunteeredBudget: str(r.volunteered_budget),
    currentState: str(project.current_state),
    pricingAsked: toBool(r.pricing_asked),
    specialRequests: str(r.special_requests),
    locality: str(project.locality),
    propertyType: str(project.property) ?? str(project.type),
    carpetArea: carpet(project.carpet_area_sqft ?? project.carpet_area),
    scope: str(project.scope_in_callers_words ?? project.scope),
    timeline: str(project.timeline),
    source,
    summary: null,
    bookingStart: confirmed ? start : null,
    bookingEnd: null, // filled from the held slot or the slot length
    bookingMode: str(booking.type),
    bookingStatus,
    outcomeReceived: true,
    transcriptReceived: false,
  };
  return { callId: topId, call };
}

// ---------------------------------------------------------------- webhook events

const PHONE_KEYS = ["phone_number", "caller_number", "from_number", "contact_number", "caller", "from", "phone"];

export type SessionEvent = { callId: string; phone: string | null };

export function eventName(body: unknown): string | null {
  return isObj(body) ? str(body.event ?? body.event_type ?? body.type)?.toLowerCase() ?? null : null;
}

export function normaliseSessionEvent(body: unknown): SessionEvent | null {
  if (!isObj(body)) return null;
  const data = isObj(body.data) ? body.data : {};
  const callId = str(pick([body, data], "call_id", "callId", "room_name"));
  if (!callId) return null;
  return { callId, phone: str(pick([data, body], ...PHONE_KEYS)) };
}

export type PostCall = {
  callId: string;
  phone: string | null;
  timestamp: string | null;
  durationSec: number | null;
  summary: string | null;
  recordingUrl: string | null;
  transcript: string;
  callerName: string | null;
  analysis: string;
};

export function normalisePostCall(body: unknown): PostCall {
  if (!isObj(body)) throw new PayloadError("Body must be a JSON object");
  const data = isObj(body.data) ? body.data : {};
  const callId = str(pick([data, body], "call_id", "callId", "room_name"));
  if (!callId) throw new PayloadError("Missing call_id");
  const entities = isObj(data.entities) ? data.entities : isObj(body.entities) ? body.entities : {};
  const dispositions = isObj(data.dispositions) ? data.dispositions : isObj(body.dispositions) ? body.dispositions : {};
  const ms = Number(pick([data, body], "call_duration", "duration"));
  const summary = str(pick([data, body], "summary", "call_summary"));

  return {
    callId,
    phone: str(pick([data, body, entities], ...PHONE_KEYS, "callback_number")),
    timestamp: toIso(pick([body, data], "timestamp", "created_at")),
    // call_postprocessing reports milliseconds (call_ended reports seconds).
    durationSec: Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : null,
    summary,
    recordingUrl: str(pick([data, body], "recording_url", "recordingUrl")),
    transcript: convertTranscript(pick([data, body], "transcript", "transcription", "messages")),
    callerName: str(pick([entities], "name", "caller_name", "customer_name", "full_name")),
    analysis: JSON.stringify({ summary, entities, dispositions, end_reason: data.end_reason ?? null }),
  };
}

// ---------------------------------------------------------------- auth

/**
 * Shared-secret check. Tool calls send it as the x-webhook-secret header; Vaani's dashboard webhook
 * has no documented custom-header option, so the secret may also ride on the URL (?secret=).
 * Open when VAANI_WEBHOOK_SECRET is unset (local dev).
 */
export function webhookAuthorised(req: Request): boolean {
  const secret = process.env.VAANI_WEBHOOK_SECRET;
  if (!secret) return true;
  const url = new URL(req.url);
  const given =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("secret") ??
    "";
  if (given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}
