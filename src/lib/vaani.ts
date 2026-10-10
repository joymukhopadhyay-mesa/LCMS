import { GATE_KEYS, type GateResult, type GateResults, type GateVerdict, type IncomingCall, type Outcome } from "./types.ts";

// Normalises Vaani's post-call webhook into IncomingCall.
//
// The canonical shape is documented in vaani/post-call-webhook.md. Because the
// exact field names depend on how the Vaani agent's post-call extraction is
// configured, this accepts common aliases (camelCase, snake_case, nested under
// analysis / extracted_data / variables) and transcripts given either as a
// string or as an array of turns. Adjust here once the real payload is known.

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

const str = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));

function toTranscript(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) {
    return v
      .map((t) => {
        if (typeof t === "string") return t;
        if (!isObj(t)) return "";
        const role = String(t.role ?? t.speaker ?? t.from ?? "").toLowerCase();
        const who = /agent|assistant|bot|ai|vaani/.test(role) ? "Vaani" : role ? "Caller" : "";
        const text = String(t.content ?? t.text ?? t.message ?? t.transcript ?? "");
        return who ? `${who}: ${text}` : text;
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

const OUTCOME_ALIASES: Record<string, Outcome> = {
  forward: "FORWARD",
  qualified: "FORWARD",
  booked: "FORWARD",
  decline: "DECLINE",
  declined: "DECLINE",
  not_qualified: "DECLINE",
  unqualified: "DECLINE",
  defer: "DEFER",
  deferred: "DEFER",
  escalate: "ESCALATE",
  escalated: "ESCALATE",
  callback: "CALLBACK",
  call_back: "CALLBACK",
  missed: "CALLBACK",
  incomplete: "CALLBACK",
  dropped: "CALLBACK",
};

function toOutcome(v: unknown): Outcome {
  const k = String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return OUTCOME_ALIASES[k] ?? "CALLBACK";
}

const VERDICTS: GateVerdict[] = ["pass", "pass-with-note", "unresolved", "fail", "silent", "not-reached"];

function toGate(v: unknown): GateResult | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") {
    const verdict = v.toLowerCase().replace(/[_\s]+/g, "-") as GateVerdict;
    return { verdict: VERDICTS.includes(verdict) ? verdict : "unresolved", note: VERDICTS.includes(verdict) ? undefined : v };
  }
  if (isObj(v)) {
    const g = toGate(v.verdict ?? v.result ?? v.status);
    return g ? { ...g, note: str(v.note ?? v.reason) ?? g.note } : undefined;
  }
  return undefined;
}

const GATE_ALIASES: Record<string, string[]> = {
  real_project: ["real_project", "g1", "gate1", "gate_1", "scope"],
  service_area: ["service_area", "g2", "gate2", "gate_2", "area", "location"],
  timeline: ["timeline", "g3", "gate3", "gate_3"],
  budget: ["budget", "budget_band", "g4", "gate4", "gate_4"],
  decision_maker: ["decision_maker", "decider", "g5", "gate5", "gate_5"],
};

function toGates(v: unknown): GateResults {
  if (!isObj(v)) return {};
  const out: GateResults = {};
  for (const key of GATE_KEYS) {
    const raw = pick([v], ...GATE_ALIASES[key]);
    const g = toGate(raw);
    if (g) out[key] = g;
  }
  return out;
}

function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v.trim()) return v.split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function toBool(v: unknown): boolean {
  return v === true || v === 1 || /^(true|yes|1)$/i.test(String(v ?? ""));
}

function toIso(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : NaN;
  const d = Number.isFinite(n) ? new Date(n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export class PayloadError extends Error {}

export function normaliseVaaniPayload(body: unknown): IncomingCall {
  if (!isObj(body)) throw new PayloadError("Body must be a JSON object");
  const root = isObj(body.call) ? { ...body, ...body.call } : body;
  const nested = ["analysis", "post_call_analysis", "extracted_data", "extraction", "variables", "data", "lead"]
    .map((k) => root[k])
    .filter(isObj);
  const s = [root, ...nested];
  const booking = pick(s, "booking", "consultation", "appointment");
  const b = isObj(booking) ? booking : {};

  const externalId = str(pick(s, "call_id", "callId", "id", "external_id", "conversation_id", "session_id"));
  if (!externalId) throw new PayloadError("Missing call id (call_id)");
  const transcript = toTranscript(pick(s, "transcript", "transcription", "messages", "conversation"));

  return {
    externalId,
    callerName: str(pick(s, "caller_name", "callerName", "name", "customer_name")),
    callerPhone: str(pick(s, "caller_phone", "callerPhone", "phone", "from_number", "from", "customer_number")),
    callerEmail: str(pick(s, "caller_email", "email")),
    receivedAt: toIso(pick(s, "received_at", "receivedAt", "started_at", "start_time", "created_at", "timestamp")) ?? new Date().toISOString(),
    durationSec: Number(pick(s, "duration_sec", "duration_seconds", "duration", "call_duration")) || null,
    transcript,
    recordingUrl: str(pick(s, "recording_url", "recordingUrl", "recording")),
    outcome: toOutcome(pick(s, "outcome", "disposition", "qualification", "qualification_outcome")),
    declineReason: str(pick(s, "decline_reason", "reason", "failed_gate")),
    gateResults: toGates(pick(s, "gate_results", "gates")),
    openQuestions: toList(pick(s, "open_questions", "openQuestions", "unresolved")),
    recoveryFlag: toBool(pick(s, "recovery_flag", "recovery", "previous_enquiry_unanswered")),
    locality: str(pick(s, "locality", "location", "area")),
    propertyType: str(pick(s, "property_type", "propertyType", "property")),
    carpetArea: str(pick(s, "carpet_area", "carpetArea", "size")),
    scope: str(pick(s, "scope", "project_scope")),
    timeline: str(pick(s, "timeline", "timeline_text")),
    source: str(pick(s, "source", "how_found", "referral_source")),
    summary: str(pick(s, "summary", "call_summary")),
    bookingStart: toIso(pick([b], "start", "start_time") ?? pick(s, "booking_start", "slot_start")),
    bookingEnd: toIso(pick([b], "end", "end_time") ?? pick(s, "booking_end", "slot_end")),
    bookingMode: str(pick([b], "mode", "type") ?? pick(s, "booking_mode")),
  };
}

/** Constant-time-ish secret check. Open when VAANI_WEBHOOK_SECRET is unset (local dev). */
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
