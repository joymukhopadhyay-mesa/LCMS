// Deterministic half of the Gemini lead-scoring logic (knowledge/Gemini-lead-scoring-logic.txt).
//
// Gemini reads the transcript and proposes signals, each with a verbatim quote.
// This module owns everything that must not drift with the model: the weights,
// the quote check (hard rule 3), the caps, the banding thresholds, the
// RECOVERY / THIN overrides, routing and confidence. Change weights here, then
// re-check the September calibration table in the logic file.

import type { Band, ScoreResult, ScoredSignal } from "./types.ts";

type SignalDef = { weight: number; axis: "readiness" | "value"; group?: string; needsQuote?: boolean; label: string };

export const SIGNALS: Record<string, SignalDef> = {
  // ---- Axis A - readiness
  named_referrer_known_to_studio: { axis: "readiness", weight: 3, group: "referral", label: "Named referrer known to the studio" },
  unnamed_referral: { axis: "readiness", weight: 1, group: "referral", label: "Unnamed referral" },
  site_empty_or_vacated: { axis: "readiness", weight: 2, label: "Site empty / caller vacated" },
  deciders_already_agreed: { axis: "readiness", weight: 2, label: "Decision already made between deciders" },
  specific_month_named: { axis: "readiness", weight: 2, group: "timeline", label: "Specific start/completion month named" },
  vague_horizon_named: { axis: "readiness", weight: 1, group: "timeline", label: "Season or vague horizon named" },
  site_visit_or_start_within_two_weeks: { axis: "readiness", weight: 2, label: "Site visit or start within two weeks" },
  booking_accepted: { axis: "readiness", weight: 1, label: "Asked to book / accepted a slot" },
  volunteered_workable_budget: { axis: "readiness", weight: 1, label: "Volunteered a budget that fits the scope" },
  comparing_studios_unhurried: { axis: "readiness", weight: -2, label: "Comparing studios and unhurried" },
  deferred_decision: { axis: "readiness", weight: -3, label: "Deferred the decision on the call" },
  intermediary_decider_not_engaged: { axis: "readiness", weight: -1, label: "Intermediary; decider not yet engaged" },
  site_access_over_three_months: { axis: "readiness", weight: -1, label: "Site access 3+ months away, no design start" },

  // ---- Axis B - value
  carpet_area_2000_plus: { axis: "value", weight: 4, group: "area", label: "Carpet area 2,000+ sq ft" },
  carpet_area_1000_1999: { axis: "value", weight: 3, group: "area", label: "Carpet area 1,000-1,999 sq ft" },
  carpet_area_600_999: { axis: "value", weight: 2, group: "area", label: "Carpet area 600-999 sq ft" },
  carpet_area_under_600: { axis: "value", weight: 1, group: "area", label: "Carpet area under 600 sq ft" },
  carpet_area_not_stated: { axis: "value", weight: 2, group: "area", needsQuote: false, label: "Carpet area not stated (neutral default)" },
  full_home: { axis: "value", weight: 3, group: "scope", label: "Full home / full fitout" },
  two_or_more_rooms: { axis: "value", weight: 2, group: "scope", label: "Two or more rooms" },
  single_room: { axis: "value", weight: 1, group: "scope", label: "Single room" },
  spec_villa_or_independent_house: { axis: "value", weight: 1, group: "spec", label: "Villa or independent house" },
  spec_senior_designer_requested: { axis: "value", weight: 1, group: "spec", label: "Principal/senior designer requested" },
  spec_leads_with_materials_or_aesthetic: { axis: "value", weight: 1, group: "spec", label: "Leads with materials / named aesthetic" },
  spec_moved_out_for_execution: { axis: "value", weight: 1, group: "spec", label: "Moved out specifically for execution" },
  headcount_50_plus: { axis: "value", weight: 2, group: "headcount", label: "50+ workstations" },
  headcount_20_49: { axis: "value", weight: 1, group: "headcount", label: "20-49 workstations" },
};

export const SIGNAL_IDS = Object.keys(SIGNALS);

export const ROUTING: Record<Band, string> = {
  HOT: "senior_designer_site_visit_within_1h",
  WARM: "next_designer_consult_same_day",
  COLD: "standard_queue_daily_batch",
  ESCALATE: "human_escalation_no_scoring",
};

export const ROUTING_LABEL: Record<string, string> = {
  senior_designer_site_visit_within_1h: "Senior designer · offer a site visit · first contact within the hour",
  next_designer_consult_same_day: "Next available designer · phone/studio consult · contact same working day",
  standard_queue_daily_batch: "Standard queue · phone consultation · brief in the day's batch",
  human_escalation_no_scoring: "Escalated to a human · not scored",
};

/** What Gemini returns (see gemini.ts responseSchema). */
export type ModelScoring = {
  is_existing_project_complaint: boolean;
  gate_conflict: string | null;
  timeline_established: boolean;
  signals: { signal: string; evidence: string }[];
  not_established: string[];
  open_questions: string[];
  one_line_for_designer: string;
};

const MAX_QUOTE_WORDS = 12;

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”'"`]/g, "")
    .replace(/[–—-]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rule 3: a signal scores only with a quote of <= 12 words that is really in the transcript. */
export function checkEvidence(evidence: string, transcript: string): string | null {
  const ev = normalise(evidence ?? "");
  if (!ev) return "no quote";
  if (ev.split(" ").length > MAX_QUOTE_WORDS) return `quote longer than ${MAX_QUOTE_WORDS} words`;
  if (!normalise(transcript).includes(ev)) return "quote not found in transcript";
  return null;
}

/** Rule 2 + field rule: the designer one-liner carries no number at all. */
export function stripNumbers(line: string): string {
  return line
    .replace(/(₹|rs\.?|inr)\s*[\d.,]+\s*(lakh|lakhs|l|cr|crore|k)?/gi, "")
    .replace(/[\d][\d.,]*\s*(sq\.?\s*ft|sqft|square feet|lakh|lakhs|bhk|cr|crore|%)?/gi, "")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/([,;])(\s*[,;.])+/g, "$2")
    .replace(/^[\s,;.]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function limitWords(s: string, n: number) {
  const w = s.split(/\s+/).filter(Boolean);
  return w.length <= n ? s : w.slice(0, n).join(" ") + "…";
}

export function finaliseScore(
  transcriptId: string,
  transcript: string,
  m: ModelScoring,
  recoveryFlag: boolean,
): ScoreResult {
  // Hard rule 7: an existing-project complaint stops scoring.
  if (m.is_existing_project_complaint) {
    return {
      transcript_id: transcriptId,
      band: "ESCALATE",
      total: 0,
      readiness: { score: 0, signals: [] },
      value: { score: 0, signals: [] },
      overrides_applied: ["ESCALATE"],
      routing: ROUTING.ESCALATE,
      confidence: "low",
      not_established: [],
      open_questions: ["Existing-project complaint reached scoring - route to a senior person now."],
      one_line_for_designer: stripNumbers(limitWords(m.one_line_for_designer || "Existing client complaint.", 20)),
      source: "gemini",
    };
  }

  const dropped: NonNullable<ScoreResult["dropped_signals"]> = [];
  const accepted: (ScoredSignal & { def: SignalDef })[] = [];
  const seen = new Set<string>();

  for (const s of m.signals ?? []) {
    const def = SIGNALS[s.signal];
    if (!def) {
      dropped.push({ signal: s.signal, weight: 0, evidence: s.evidence, reason: "unknown signal" });
      continue;
    }
    if (seen.has(s.signal)) continue;
    const problem = def.needsQuote === false ? null : checkEvidence(s.evidence, transcript);
    if (problem) {
      dropped.push({ signal: s.signal, weight: def.weight, evidence: s.evidence, reason: problem });
      continue;
    }
    seen.add(s.signal);
    accepted.push({ signal: s.signal, weight: def.weight, evidence: s.evidence ?? "", def });
  }

  // Mutually exclusive groups keep only their strongest member.
  const best = new Map<string, (typeof accepted)[number]>();
  const kept: typeof accepted = [];
  for (const s of accepted) {
    const g = s.def.group;
    if (!g || g === "spec" || g === "headcount") {
      kept.push(s);
      continue;
    }
    const cur = best.get(g);
    if (!cur || s.weight > cur.weight) best.set(g, s);
  }
  kept.push(...best.values());

  // Area defaults to "not stated" (+2) when nothing was established. Absence is not evidence of small.
  if (!kept.some((s) => s.def.group === "area")) {
    kept.push({ signal: "carpet_area_not_stated", weight: 2, evidence: "", def: SIGNALS.carpet_area_not_stated });
  }

  // Office headcount replaces specification markers; specification markers cap at +2.
  const hasHeadcount = kept.some((s) => s.def.group === "headcount");
  let specCount = 0;
  const final = kept.filter((s) => {
    if (s.def.group === "spec") {
      if (hasHeadcount) return false;
      specCount += 1;
      return specCount <= 2;
    }
    if (s.def.group === "headcount") {
      const top = kept.filter((k) => k.def.group === "headcount").sort((a, b) => b.weight - a.weight)[0];
      return s === top;
    }
    return true;
  });

  const strip = ({ signal, weight, evidence }: ScoredSignal) => ({ signal, weight, evidence });
  const rSignals = final.filter((s) => s.def.axis === "readiness").map(strip);
  const vSignals = final.filter((s) => s.def.axis === "value").map(strip);
  const clamp = (n: number) => Math.max(0, Math.min(10, n));
  const readiness = clamp(rSignals.reduce((a, s) => a + s.weight, 0));
  const value = clamp(vSignals.reduce((a, s) => a + s.weight, 0));
  const total = readiness + value;

  let band: Band = total >= 13 || readiness >= 8 ? "HOT" : total >= 7 ? "WARM" : "COLD";
  const overrides: string[] = [];
  const openQuestions = [...(m.open_questions ?? [])];
  const notEstablished = [...(m.not_established ?? [])];

  const areaKnown = final.some((s) => s.def.group === "area" && s.signal !== "carpet_area_not_stated");
  const timelineKnown = m.timeline_established || final.some((s) => s.def.group === "timeline");
  if (!areaKnown && !notEstablished.includes("carpet_area")) notEstablished.push("carpet_area");
  if (!timelineKnown && !notEstablished.includes("timeline")) notEstablished.push("timeline");

  let confidence: ScoreResult["confidence"] =
    areaKnown && timelineKnown ? "high" : areaKnown || timelineKnown ? "medium" : "low";

  // Hard rule 1: never re-qualify - a gate conflict is COLD + low confidence + a question for a human.
  if (m.gate_conflict) {
    band = "COLD";
    confidence = "low";
    overrides.push("GATE_CONFLICT");
    openQuestions.push(`Gate conflict for a human to check: ${m.gate_conflict}`);
  }

  // THIN: fewer than three scored signals (the area default is not a scored signal).
  const scoredCount = final.filter((s) => s.signal !== "carpet_area_not_stated").length;
  if (scoredCount < 3) {
    overrides.push("THIN");
    confidence = "low";
  }

  // RECOVERY: the studio already failed this caller once - route hot regardless of band.
  if (recoveryFlag && band !== "HOT") {
    band = "HOT";
    overrides.push("RECOVERY");
  } else if (recoveryFlag) {
    overrides.push("RECOVERY");
  }

  return {
    transcript_id: transcriptId,
    band,
    total,
    readiness: { score: readiness, signals: rSignals },
    value: { score: value, signals: vSignals },
    overrides_applied: overrides,
    routing: ROUTING[band],
    confidence,
    not_established: notEstablished,
    open_questions: openQuestions,
    one_line_for_designer: stripNumbers(limitWords(m.one_line_for_designer ?? "", 20)),
    dropped_signals: dropped.length ? dropped : undefined,
    source: "gemini",
  };
}
