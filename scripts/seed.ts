// Seeds the dashboard with the 20 September 2026 phone calls from the case
// pack (knowledge/september-2026-enquiries.txt), as if Vaani had taken them.
//
//   npm run seed            -> wipe and reload demo data
//
// Vaani outcomes and gate verdicts follow the worked-examples table in
// Vaani-qualification-rubric.txt. Bands come from running hand-labelled
// signals (each with a verbatim quote) through the app's real scoring engine,
// and the result is compared with the calibration table in the scoring logic.
// "Front Desk" is relabelled "Vaani" so the transcripts read as they would live.

import fs from "node:fs";
import path from "node:path";
import { insertCall, resetDatabase, saveScore, updatePrice, logEvent } from "../src/lib/repo.ts";
import { finaliseScore } from "../src/lib/scoring.ts";
import type { GateResults, IncomingCall, LeadFacts, Outcome } from "../src/lib/types.ts";
import { db } from "../src/lib/db.ts";

const raw = fs.readFileSync(path.resolve("knowledge/september-2026-enquiries.txt"), "utf8")
  .replace(/^--- page \d+ ---$/gm, "")
  .split("SECTION 2")[0];

// ---------------------------------------------------------------- transcript parsing

type Parsed = { id: string; receivedAt: string; durationSec: number | null; transcript: string };

const MONTHS: Record<string, number> = { September: 8 };

function toIso(day: number, month: string, time: string): string {
  const m = time.match(/(\d+):(\d+)(am|pm)/)!;
  let h = Number(m[1]) % 12;
  if (m[3] === "pm") h += 12;
  return new Date(Date.UTC(2026, MONTHS[month], day, h, Number(m[2])) - 330 * 60_000).toISOString();
}

function durations(text: string): number | null {
  const all = [...text.matchAll(/(\d+) min (\d+) sec/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
  return all.length ? all.reduce((a, b) => a + b, 0) : null;
}

function unwrap(body: string): string {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const startsTurn = /^[A-Za-z][A-Za-z ]{0,20}:/.test(line) || /^(First|Second) call|^Missed call/.test(line);
    if (startsTurn || !out.length) out.push(line);
    else out[out.length - 1] += " " + line;
  }
  return out.join("\n").replace(/^Front Desk:/gm, "Vaani:");
}

function parse(): Map<string, Parsed> {
  const map = new Map<string, Parsed>();
  const re = /^(T\d\d) · Phone · (\d+) (\w+) · (\d+:\d+[ap]m)(.*)$/gm;
  const heads = [...raw.matchAll(re)];
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index! : raw.length;
    const body = raw.slice(h.index! + h[0].length, end);
    map.set(h[1], {
      id: h[1],
      receivedAt: toIso(Number(h[2]), h[3], h[4]),
      durationSec: durations(h[5] + "\n" + body),
      transcript: unwrap(body),
    });
  });
  return map;
}

// ---------------------------------------------------------------- per-call labels

type G = "pass" | "pass-with-note" | "unresolved" | "fail" | "silent" | "not-reached";
const gates = (g1: G, g2: G, g3: G, g4: G, g5: G, notes: Partial<Record<keyof GateResults, string>> = {}): GateResults => {
  const mk = (verdict: G, key: keyof GateResults) => ({ verdict, ...(notes[key] ? { note: notes[key] } : {}) });
  return {
    real_project: mk(g1, "real_project"),
    service_area: mk(g2, "service_area"),
    timeline: mk(g3, "timeline"),
    budget: mk(g4, "budget"),
    decision_maker: mk(g5, "decision_maker"),
  };
};

type Seed = {
  outcome: Outcome;
  name?: string;
  phone?: string;
  reason?: string;
  gates: GateResults;
  facts?: Partial<LeadFacts>;
  open?: string[];
  recovery?: boolean;
  booking?: { days: number; time: string; mode: string };
  signals?: [string, string][];
  oneLine?: string;
  calibration?: [number, number, string]; // R, V, band from the logic file
};

const P = "+91 98xxx xx";
const S: Record<string, Seed> = {
  T01: {
    outcome: "FORWARD", name: "Priya", phone: `${P}101`, gates: gates("pass", "pass", "pass", "silent", "pass"),
    facts: { locality: "Kothrud (Dahanukar Colony)", property_type: "3BHK apartment", carpet_area: "~1,400 sq ft carpet", scope: "Whole flat - kitchen, living room, both bedrooms", timeline: "Done by March, no rush", source: "Referral - Shruti Joshi (past client, Aundh)",
      brief: "Priya and her husband own a builder-finish 3BHK in Kothrud and want the whole flat redone. Referred by Shruti Joshi, whose Aundh flat Aangan did. Husband has agreed; target is March." },
    booking: { days: 3, time: "11:00", mode: "site visit" },
    signals: [["named_referrer_known_to_studio", "She had her flat done by you in Aundh"], ["deciders_already_agreed", "He knows we're calling and is happy to go ahead"], ["specific_month_named", "We'd like to be done by March"], ["booking_accepted", "Sure. (gives number)"], ["carpet_area_1000_1999", "About 1,400 sq ft carpet"], ["full_home", "We want to redo the whole thing"]],
    oneLine: "Past-client referral, both owners agreed, whole flat, wants it finished by March.", calibration: [8, 6, "HOT"],
  },
  T02: {
    outcome: "FORWARD", phone: `${P}102`, gates: gates("pass", "pass", "pass", "silent", "silent"),
    facts: { locality: "Wakad", property_type: "2BHK", carpet_area: "~950 sq ft", scope: "Full redesign - modular kitchen, wardrobes, living room, both bedrooms", timeline: "Moving in November; design from October", source: "Instagram",
      brief: "Instagram enquiry for a full 2BHK redesign in Wakad, moving in November. Pushed twice for a ballpark price and booked once told the designer would cover it." },
    open: ["Who else decides? Decision-maker was not discussed."],
    booking: { days: 2, time: "15:00", mode: "studio" },
    signals: [["specific_month_named", "We move in November"], ["booking_accepted", "Okay, fair enough. Let's book it."], ["carpet_area_600_999", "About 950 sq ft"], ["full_home", "Full redesign — modular kitchen, wardrobes, living room, both bedrooms"]],
    oneLine: "Full flat redesign before a November move-in; asked hard for pricing, then booked.", calibration: [3, 5, "WARM"],
  },
  T03: { outcome: "DECLINE", name: "Suresh Patil", phone: `${P}103`, reason: "G2 · Outside service area (Nashik)", gates: gates("pass", "fail", "not-reached", "not-reached", "not-reached", { service_area: "Nashik" }), facts: { locality: "Nashik", source: "LinkedIn", scope: "Home office and study" } },
  T04: { outcome: "DECLINE", phone: `${P}104`, reason: "G1 · Advice only, no execution", gates: gates("fail", "pass", "not-reached", "not-reached", "not-reached", { real_project: "Wants colour/furniture suggestions only" }), facts: { scope: "Living room ideas only" } },
  T05: {
    outcome: "FORWARD", name: "Aarti Mehta", phone: `${P}105`, gates: gates("pass", "pass", "pass", "silent", "pass"),
    facts: { locality: "Koregaon Park", property_type: "4BHK apartment", carpet_area: "~2,400 sq ft carpet", scope: "Complete redesign - new flooring, kitchen, all four bedrooms", timeline: "Move back in by February (~4 months)", source: "Referral - Vikram Agarwal (close friend of Nikhil)",
      brief: "Aarti Mehta wants a complete redesign of a 2,400 sq ft 4BHK in Koregaon Park. Family has already moved out; they want to be back by February. Referred by Vikram Agarwal, a close friend of Nikhil's; asked for a site visit." },
    booking: { days: 4, time: "11:00", mode: "site visit" },
    signals: [["named_referrer_known_to_studio", "Vikram Agarwal asked me to call"], ["site_empty_or_vacated", "We've already moved out temporarily"], ["specific_month_named", "We want to move back in by February"], ["booking_accepted", "Yes please — Vikram said your team does that"], ["carpet_area_2000_plus", "about 2,400 sq ft carpet"], ["full_home", "Complete redesign. New flooring, kitchen, all four bedrooms"]],
    oneLine: "Referred by a friend of Nikhil's, flat already vacated, February deadline.", calibration: [8, 7, "HOT"],
  },
  T06: {
    outcome: "FORWARD", phone: `${P}106`, gates: gates("pass", "pass", "pass", "silent", "pass", { decision_maker: "Caller is the founder" }),
    facts: { caller_name: "Startup founder (Baner)", locality: "Baner", property_type: "Office - bare shell", carpet_area: "~800 sq ft", scope: "Workstations for 20, a cabin, meeting room, break area", timeline: "Operational by December", source: null,
      brief: "Startup founder with a bare-shell 800 sq ft office in Baner needs a full fitout for 20 people. Wants to be operational by December; team is working from home until then." },
    booking: { days: 3, time: "15:00", mode: "site visit" },
    signals: [["site_empty_or_vacated", "Bare shell — just columns and floor"], ["deciders_already_agreed", "Yes, I'm the founder"], ["specific_month_named", "We want to be operational by December"], ["booking_accepted", "Let's set up a consultation"], ["carpet_area_600_999", "About 800 sq ft"], ["full_home", "We need workstations for 20 people, a small cabin, a meeting room"], ["headcount_20_49", "workstations for 20 people"]],
    oneLine: "Founder deciding, bare-shell office, full fitout, operational by December.", calibration: [7, 6, "HOT"],
  },
  T07: { outcome: "DEFER", phone: `${P}107`, reason: "G3 · Timeline - wanted it done before Diwali (3 weeks)", gates: gates("pass", "pass", "fail", "silent", "silent", { timeline: "Before Diwali, ~3 weeks out; November start offered" }), facts: { scope: "Living room and kitchen" }, open: ["Offered a November start - caller said they would call back."] },
  T08: { outcome: "CALLBACK", phone: `${P}108`, reason: "Missed call at 10:47pm, no voicemail", gates: {}, facts: { locality: "Nanded City (number area)" } },
  T09: { outcome: "ESCALATE", name: "Sheetal Deshpande", phone: `${P}109`, reason: "Existing project complaint - designer (Aryan) unresponsive for 5 days", gates: {}, facts: { locality: "Viman Nagar", property_type: "2BHK (existing project)" } },
  T10: { outcome: "DECLINE", phone: `${P}110`, reason: "G4 · Volunteered budget far below scope", gates: gates("pass", "pass", "silent", "fail", "pass", { budget: "Volunteered a budget far below a kitchen + bedroom with execution" }), facts: { locality: "Kharadi", property_type: "1BHK", carpet_area: "~550 sq ft", scope: "Kitchen and one bedroom" } },
  T11: {
    outcome: "FORWARD", phone: `${P}111`, gates: gates("pass", "pass", "pass", "silent", "pass", { decision_maker: "Tenant; landlord has agreed - no wall-breaking" }),
    facts: { locality: "Baner", property_type: "Rented 2BHK (3-year lease)", carpet_area: null, scope: "Living room, bedroom and kitchen - no structural changes", timeline: null, source: null,
      brief: "Tenant on a 3-year lease in a bare Baner 2BHK wants the living room, bedroom and kitchen properly designed. Landlord is fine as long as no walls are broken, so everything must be reversible." },
    open: ["When do they want it done?", "Carpet area?"],
    booking: { days: 4, time: "17:30", mode: "studio" },
    signals: [["booking_accepted", "Yes please."], ["full_home", "properly design the living room, bedroom, and kitchen"]],
    oneLine: "Rented flat, landlord cleared, reversible full design, no date named.", calibration: [2, 5, "WARM"],
  },
  T12: {
    outcome: "FORWARD", name: "Anand Sharma", phone: `${P}112`, gates: gates("pass", "pass", "pass", "silent", "pass"),
    facts: { locality: "Kalyani Nagar", property_type: "Villa (ground + two floors), new construction", carpet_area: "~5,500 sq ft", scope: "Full end-to-end design", timeline: "Move in March next year", source: null,
      brief: "Anand Sharma has an empty new-build villa in Kalyani Nagar, about 5,500 sq ft over three floors, and wants full end-to-end design for a March move-in. Wants the principal designer on site this week or next." },
    booking: { days: 2, time: "11:00", mode: "site visit (principal designer)" },
    signals: [["site_empty_or_vacated", "Completely empty"], ["specific_month_named", "March next year to move in"], ["site_visit_or_start_within_two_weeks", "Yes — this week or next if possible"], ["booking_accepted", "Yes — this week or next if possible"], ["carpet_area_2000_plus", "The property is about 5,500 sq ft"], ["full_home", "Full end-to-end design"], ["spec_villa_or_independent_house", "I'm calling about a villa project in Kalyani Nagar"]],
    oneLine: "Empty new villa, full design, March move-in, wants the principal designer on site now.", calibration: [7, 8, "HOT"],
  },
  T13: {
    outcome: "FORWARD", phone: `${P}113`, gates: gates("pass", "pass", "unresolved", "silent", "silent", { timeline: "Never established - call moved to booking" }),
    facts: { locality: "Aundh", property_type: "3BHK", carpet_area: "~1,100 sq ft", scope: "Kitchen, wardrobes in both bedrooms, living room", timeline: null, source: null,
      brief: "Aundh 3BHK, about 1,100 sq ft - kitchen, wardrobes and living room. Pushed twice for a rough cost, then booked. Timeline was never asked." },
    open: ["When would they need the project complete?"],
    booking: { days: 3, time: "17:30", mode: "phone" },
    signals: [["booking_accepted", "Fine. Let's book then."], ["carpet_area_1000_1999", "3BHK, about 1,100 sq ft"], ["full_home", "Kitchen, wardrobes in both bedrooms, living room"]],
    oneLine: "Aundh flat, kitchen wardrobes and living room; price-focused, timeline unknown.", calibration: [1, 6, "WARM"],
  },
  T14: {
    outcome: "FORWARD", phone: `${P}114`, gates: gates("pass", "pass", "silent", "silent", "pass-with-note", { decision_maker: "Son calling; parents own the flat, decide, and will attend" }),
    facts: { caller_name: "Son of the owners (Hadapsar)", locality: "Hadapsar", property_type: "3BHK, new possession", carpet_area: null, scope: "Proper design of the new flat", timeline: null, source: null,
      brief: "A son enquiring for his parents' newly possessed 3BHK in Hadapsar. Parents decide and will come to the consultation but have not yet agreed to go ahead." },
    open: ["Have the parents agreed to proceed?", "Timeline and carpet area?"],
    signals: [["intermediary_decider_not_engaged", "I'm just calling to see if it's worth pursuing"], ["booking_accepted", "Please. (gives number)"], ["full_home", "They want a proper design"]],
    oneLine: "Son enquiring for parents' new flat; parents will attend but haven't decided.", calibration: [1, 5, "COLD"],
  },
  T15: {
    outcome: "FORWARD", name: "Smita", phone: `${P}115`, gates: gates("pass", "pass", "pass", "silent", "pass"),
    facts: { locality: "Undri", property_type: "2BHK, possession in ~6 weeks", carpet_area: "~875 sq ft", scope: "Full home - kitchen, wardrobes, living room", timeline: "Possession in ~6 weeks; start design now", source: null,
      brief: "Smita gets possession of an 875 sq ft Undri 2BHK in about six weeks and wants to start design now. Husband said go ahead and book; the builder will let them into the site now." },
    booking: { days: 2, time: "17:30", mode: "site visit" },
    signals: [["site_empty_or_vacated", "I'm getting possession of my flat in Undri in about six weeks"], ["deciders_already_agreed", "He said to go ahead and book the consultation"], ["site_visit_or_start_within_two_weeks", "We can go now — the builder will let us in"], ["booking_accepted", "He said to go ahead and book the consultation"], ["carpet_area_600_999", "2BHK, 875 sq ft"], ["full_home", "Full home — kitchen, wardrobes, living room"]],
    oneLine: "Spouse already agreed, site accessible now, full home in a new flat.", calibration: [7, 5, "WARM"],
  },
  T16: {
    outcome: "FORWARD", name: "Girish Nair", phone: `${P}116`, recovery: true, gates: gates("pass", "pass", "silent", "silent", "silent"),
    facts: { locality: "Viman Nagar", property_type: "3BHK", carpet_area: null, scope: null, timeline: null, source: "Called Monday - no follow-up",
      brief: "Girish Nair called on Monday about his Viman Nagar 3BHK and nobody called back. He is frustrated and judging the studio on this response. Scope and timeline need re-asking - carefully." },
    open: ["Re-take scope and timeline without making him repeat everything."],
    booking: { days: 1, time: "11:00", mode: "phone" },
    signals: [["booking_accepted", "I'll book the consultation directly now so it doesn't slip again"]],
    oneLine: "Second call after no follow-up; frustrated - handle with care.", calibration: [0, 0, "HOT"],
  },
  T17: {
    outcome: "FORWARD", name: "Ritu Kapoor", phone: `${P}117`, gates: gates("pass", "pass", "pass", "silent", "silent"),
    facts: { locality: "Pimple Saudagar", property_type: "3BHK", carpet_area: "~1,050 sq ft", scope: "Kitchen, wardrobes, living room (replacing builder furniture)", timeline: "Ideally done by March", source: null,
      brief: "Ritu Kapoor (call dropped once, she called back) has lived in a Pimple Saudagar 3BHK for two years with builder furniture and wants kitchen, wardrobes and living room done by March." },
    booking: { days: 3, time: "11:00", mode: "studio" },
    signals: [["specific_month_named", "Ideally done by March"], ["booking_accepted", "Let me book a consultation"], ["carpet_area_1000_1999", "3BHK, about 1,050 sq ft"], ["full_home", "Kitchen, wardrobes, living room"]],
    oneLine: "Lived-in flat with builder furniture, kitchen wardrobes living room, March target.", calibration: [3, 6, "WARM"],
  },
  T18: {
    outcome: "FORWARD", phone: `${P}118`, gates: gates("unresolved", "pass", "silent", "silent", "pass", { real_project: "180 sq ft pod - services.md sets no commercial minimum" }),
    facts: { caller_name: "Coworking operator", scope: "180 sq ft coworking pod - lighting, desk, storage", carpet_area: "180 sq ft", property_type: "Commercial pod" },
    open: ["Is a 180 sq ft pod a project the studio will take? services.md has no commercial floor."],
  },
  T19: { outcome: "DECLINE", phone: `${P}119`, reason: "G1 · Out of scope (restaurant / hospitality)", gates: gates("fail", "pass", "not-reached", "not-reached", "not-reached", { real_project: "Restaurant - not a project type Aangan takes" }), facts: { locality: "Koregaon Park", scope: "Restaurant interiors" } },
  T20: {
    outcome: "FORWARD", name: "Pooja", phone: `${P}120`, gates: gates("pass", "pass", "pass", "silent", "pass"),
    facts: { locality: "Magarpatta (Cybercity)", property_type: "2BHK", carpet_area: "~900 sq ft", scope: "Kitchen, both bedrooms, living room", timeline: "January start for execution", source: null,
      brief: "Pooja and her husband want their 900 sq ft Magarpatta 2BHK properly designed - kitchen, both bedrooms, living room - with execution starting in January. Both will attend." },
    booking: { days: 2, time: "11:00", mode: "studio" },
    signals: [["deciders_already_agreed", "We both want to be at the consultation"], ["specific_month_named", "a January start for execution would be ideal"], ["booking_accepted", "Please."], ["carpet_area_600_999", "About 900 sq ft"], ["full_home", "Kitchen, both bedrooms, living room"]],
    oneLine: "Both owners attending, January start, kitchen bedrooms and living room.", calibration: [5, 5, "WARM"],
  },
};

// ---------------------------------------------------------------- load

function bookingIso(receivedAt: string, days: number, time: string): [string, string] {
  const d = new Date(new Date(receivedAt).getTime() + 330 * 60_000 + days * 86400_000);
  const [hh, mm] = time.split(":").map(Number);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm) - 330 * 60_000);
  return [start.toISOString(), new Date(start.getTime() + 3600_000).toISOString()];
}

const parsed = parse();
db();
resetDatabase();

const report: string[] = [];
for (const [tid, seed] of Object.entries(S)) {
  const p = parsed.get(tid);
  if (!p) throw new Error(`transcript ${tid} not found in knowledge file`);
  const f = seed.facts ?? {};
  const [bs, be] = seed.booking ? bookingIso(p.receivedAt, seed.booking.days, seed.booking.time) : [null, null];
  const call: IncomingCall = {
    externalId: `SEP26-${tid}`,
    callerName: seed.name ?? f.caller_name ?? null,
    callerPhone: seed.phone ?? null,
    callerEmail: null,
    receivedAt: p.receivedAt,
    durationSec: p.durationSec,
    transcript: p.transcript,
    recordingUrl: null,
    outcome: seed.outcome,
    declineReason: seed.reason ?? null,
    gateResults: seed.gates,
    openQuestions: seed.open ?? [],
    recoveryFlag: Boolean(seed.recovery),
    locality: f.locality ?? null,
    propertyType: f.property_type ?? null,
    carpetArea: f.carpet_area ?? null,
    scope: f.scope ?? null,
    timeline: f.timeline ?? null,
    source: f.source ?? null,
    summary: seed.outcome === "FORWARD" ? null : seed.reason ?? null,
    bookingStart: bs,
    bookingEnd: be,
    bookingMode: seed.booking?.mode ?? null,
  };
  const { id } = insertCall(call);

  if (seed.signals) {
    const score = finaliseScore(call.externalId, call.transcript, {
      is_existing_project_complaint: false,
      gate_conflict: null,
      timeline_established: Boolean(f.timeline),
      signals: seed.signals.map(([signal, evidence]) => ({ signal, evidence })),
      not_established: [],
      open_questions: [],
      one_line_for_designer: seed.oneLine ?? "",
    }, Boolean(seed.recovery));
    score.source = "calibration_table";
    const facts: LeadFacts = {
      caller_name: f.caller_name ?? null, locality: null, property_type: null, carpet_area: null, scope: null,
      timeline: null, source: null, budget_volunteered: null, brief: f.brief ?? "",
    };
    saveScore(id, score, facts, { input: 0, output: 0 });
    logEvent(id, "gemini", "skipped", "Seeded from the September calibration table (no Gemini call)");

    const [cr, cv, cb] = seed.calibration!;
    const match = score.band === cb ? "ok " : "DIFF";
    report.push(`${match} ${tid}  engine R${score.readiness.score} V${score.value.score} = ${score.total} ${score.band.padEnd(5)}  calibration R${cr} V${cv} ${cb}` +
      (score.dropped_signals ? `  dropped: ${score.dropped_signals.map((d) => `${d.signal} (${d.reason})`).join(", ")}` : "") +
      (score.overrides_applied.length ? `  overrides: ${score.overrides_applied.join(",")}` : ""));
  } else if (seed.outcome === "FORWARD") {
    report.push(`--   ${tid}  left unscored (forward + note) - use "Score now" once GEMINI_API_KEY is set`);
  }
}

// A worked price history so the edit log has something to show.
const t01 = db().prepare("SELECT id FROM calls WHERE external_id = 'SEP26-T01'").get() as { id: string };
updatePrice({ callId: t01.id, minLakh: 25, maxLakh: 34, note: "Standard spec, 1,400 sq ft carpet", editedBy: "Nikhil" });
updatePrice({ callId: t01.id, minLakh: 27, maxLakh: 32, note: "Narrowed after site photos - flooring retained", editedBy: "Nikhil" });
const t05 = db().prepare("SELECT id FROM calls WHERE external_id = 'SEP26-T05'").get() as { id: string };
updatePrice({ callId: t05.id, minLakh: 58, maxLakh: 84, note: "Premium spec, full flooring replacement", editedBy: "Nikhil" });

const count = db().prepare("SELECT COUNT(*) AS n FROM calls").get() as { n: number };
console.log(`Seeded ${count.n} calls into ${process.env.DATABASE_PATH || "./data/lcms.db"}\n`);
console.log("Scoring engine vs. calibration table:");
console.log(report.join("\n"));
