// Shared domain types for the Vaani -> Gemini -> outputs pipeline.

/** What Vaani decided on the call (rubric section 2.2). NOT_ENQUIRY = wrong number, vendor, job seeker. */
export type Outcome = "FORWARD" | "DECLINE" | "DEFER" | "ESCALATE" | "CALLBACK" | "NOT_ENQUIRY";

export type Band = "HOT" | "WARM" | "COLD" | "ESCALATE";

export type GateVerdict = "pass" | "pass-with-note" | "unresolved" | "fail" | "silent" | "not-reached";

export const GATE_KEYS = ["real_project", "service_area", "timeline", "budget", "decision_maker"] as const;
export type GateKey = (typeof GATE_KEYS)[number];

export const GATE_LABELS: Record<GateKey, string> = {
  real_project: "G1 · Real project",
  service_area: "G2 · Service area",
  timeline: "G3 · Timeline",
  budget: "G4 · Budget band",
  decision_maker: "G5 · Decision-maker",
};

export type GateResult = { verdict: GateVerdict; note?: string };
export type GateResults = Partial<Record<GateKey, GateResult>>;

/** Normalised post-call payload, whatever shape Vaani actually posts. */
export type IncomingCall = {
  externalId: string;
  callerName: string | null;
  callerPhone: string | null;
  callerEmail: string | null;
  receivedAt: string; // ISO
  durationSec: number | null;
  transcript: string;
  recordingUrl: string | null;
  outcome: Outcome;
  declineReason: string | null;
  gateResults: GateResults;
  openQuestions: string[];
  recoveryFlag: boolean;
  locality: string | null;
  propertyType: string | null;
  carpetArea: string | null;
  scope: string | null;
  timeline: string | null;
  source: string | null;
  summary: string | null;
  bookingStart: string | null;
  bookingEnd: string | null;
  bookingMode: string | null;
  bookingStatus?: string | null; // confirmed | pending | none
  language?: string | null;
  volunteeredBudget?: string | null;
  currentState?: string | null;
  pricingAsked?: boolean;
  specialRequests?: string | null;
  vaaniAnalysis?: string | null; // raw summary/entities/dispositions JSON from the post-call event
  /** Vaani sends the outcome record mid-call and the transcript afterwards; each flag says which has arrived. */
  outcomeReceived?: boolean;
  transcriptReceived?: boolean;
};

export type ScoredSignal = {
  signal: string;
  weight: number;
  evidence: string;
};

/** Output contract of Gemini-lead-scoring-logic.txt, after the app enforces its rules. */
export type ScoreResult = {
  transcript_id: string;
  band: Band;
  total: number;
  readiness: { score: number; signals: ScoredSignal[] };
  value: { score: number; signals: ScoredSignal[] };
  overrides_applied: string[];
  routing: string;
  confidence: "high" | "medium" | "low";
  not_established: string[];
  open_questions: string[];
  one_line_for_designer: string;
  /** Signals Gemini proposed that failed the "every signal needs a quote" check. */
  dropped_signals?: (ScoredSignal & { reason: string })[];
  source?: "gemini" | "calibration_table";
};

/** Facts Gemini extracts for the dashboard and the designer brief. */
export type LeadFacts = {
  caller_name: string | null;
  locality: string | null;
  property_type: string | null;
  carpet_area: string | null;
  scope: string | null;
  timeline: string | null;
  source: string | null;
  budget_volunteered: string | null;
  brief: string;
};

export type CallRow = {
  id: string;
  external_id: string;
  caller_name: string | null;
  caller_phone: string | null;
  caller_email: string | null;
  received_at: string;
  duration_sec: number | null;
  transcript: string;
  recording_url: string | null;
  outcome: Outcome;
  decline_reason: string | null;
  gate_results: string; // JSON GateResults
  open_questions: string; // JSON string[]
  recovery_flag: number;
  locality: string | null;
  property_type: string | null;
  carpet_area: string | null;
  scope: string | null;
  timeline: string | null;
  source: string | null;
  summary: string | null;
  brief: string | null;
  booking_start: string | null;
  booking_end: string | null;
  booking_mode: string | null;
  booking_status: string | null;
  language: string | null;
  volunteered_budget: string | null;
  current_state: string | null;
  pricing_asked: number;
  special_requests: string | null;
  vaani_analysis: string | null;
  phone_key: string | null;
  outcome_received_at: string | null;
  transcript_received_at: string | null;
  pipeline_started_at: string | null;
  band: Band | null;
  score_total: number | null;
  readiness: number | null;
  value_score: number | null;
  confidence: string | null;
  routing: string | null;
  one_line: string | null;
  scoring_json: string | null;
  scoring_status: "pending" | "scored" | "failed" | "not_applicable";
  scoring_error: string | null;
  scored_at: string | null;
  gemini_input_tokens: number;
  gemini_output_tokens: number;
  price_min_lakh: number | null;
  price_max_lakh: number | null;
  price_note: string | null;
  price_updated_at: string | null;
  hubspot_contact_id: string | null;
  created_at: string;
};

export type PriceEdit = {
  id: number;
  call_id: string;
  old_min_lakh: number | null;
  old_max_lakh: number | null;
  new_min_lakh: number;
  new_max_lakh: number;
  note: string | null;
  edited_by: string;
  edited_at: string;
};

export type Channel = "gemini" | "telegram" | "email" | "calendar" | "hubspot";

export type IntegrationEvent = {
  id: number;
  call_id: string;
  channel: Channel;
  status: "sent" | "failed" | "skipped";
  detail: string | null;
  external_ref: string | null;
  created_at: string;
};
