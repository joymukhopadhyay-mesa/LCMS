// Plays the part of Vaani against a running app, in the order a real call arrives:
//
//   call_started webhook            (caller's number)
//   check_availability  tool        GET  /api/vaani/slots
//   book_consultation   tool        POST /api/vaani/book
//   submit_call_outcome tool        POST /api/vaani/outcome      <- the record from the system prompt
//   call_postprocessing webhook     POST /api/webhooks/vaani     <- transcript, summary, recording
//
//   npm run simulate                              forward + booking, against http://localhost:3000
//   npm run simulate -- <base-url> decline        out-of-area decline
//   npm run simulate -- <base-url> escalate       existing client complaint
//   npm run simulate -- <base-url> no-outcome     transcript arrives but the outcome tool call never did
//
// Uses VAANI_WEBHOOK_SECRET from the environment (or .env.local) if set.

import fs from "node:fs";

const base = (process.argv[2] || process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const kind = process.argv[3] || "forward";

function envSecret() {
  if (process.env.VAANI_WEBHOOK_SECRET) return process.env.VAANI_WEBHOOK_SECRET;
  try {
    const m = fs.readFileSync(".env.local", "utf8").match(/^VAANI_WEBHOOK_SECRET=(.+)$/m);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}
const secret = envSecret();
const headers = { "content-type": "application/json", ...(secret ? { "x-webhook-secret": secret } : {}) };
const webhookUrl = `${base}/api/webhooks/vaani${secret ? `?secret=${secret}` : ""}`;

const callId = `inbound-${Math.floor(Date.now() / 1000)}-${Math.random().toString(16).slice(2, 10)}`;
const phone = `+91 98${Math.floor(10000000 + Math.random() * 89999999)}`;

const ts = (offsetSec) => {
  const d = new Date(Date.now() + offsetSec * 1000);
  return `[${d.toTimeString().slice(0, 8)}]`;
};
const lines = (turns) => turns.map(([who, text], i) => `${ts(i * 6)} ${who}: ${text}`).join("\n");

const SCRIPTS = {
  forward: lines([
    ["AGENT", "Good evening, Aangan Studio, this is Vaani. How can I help?"],
    ["USER", "Hi, I'm Amol Patil. Our builder, Rohan Lifescapes, referred us to you."],
    ["AGENT", "Thanks for calling, Amol. What are you looking to do?"],
    ["USER", "We got possession of a 3BHK in Kondhwa in August. It's completely bare, builder handover. About 1,150 sq ft. We want the full home done."],
    ["AGENT", "That sounds like a complete design and execution project. When would you want it finished?"],
    ["USER", "We want to move in by March 2027. My wife has already said yes, we've been waiting to start."],
    ["AGENT", "Lovely. Shall I find you a time for a site visit?"],
    ["USER", "Yes please, an evening this week if possible."],
    ["AGENT", "I can do Monday at 4:30 pm. Would that work?"],
    ["USER", "That works. Roughly what will it cost, by the way?"],
    ["AGENT", "It really follows the specification. What range did you have in mind for the full home?"],
    ["USER", "I'd rather discuss it at the meeting."],
    ["AGENT", "Of course. Your designer will walk you through pricing once they have seen the site. You are booked, and they will have all your details."],
  ]),
  decline: lines([
    ["AGENT", "Good afternoon, Aangan Studio, this is Vaani. How can I help?"],
    ["USER", "Hello, I have a 2BHK in Lonavala, a weekend home. Can you do the interiors?"],
    ["AGENT", "Thanks for thinking of us. We only work in Pune and PCMC, because our execution depends on our own contractors being on site. I am sorry we cannot take Lonavala."],
    ["USER", "Okay, no problem. Thanks for telling me straight."],
  ]),
  escalate: lines([
    ["AGENT", "Good morning, Aangan Studio, this is Vaani. How can I help?"],
    ["USER", "I need to speak to someone right now. My project has been going three months and my designer hasn't replied in five days."],
    ["AGENT", "I am very sorry. Can I take your name and your designer's name?"],
    ["USER", "Sheetal Deshpande. My designer is Aryan. Flat in Viman Nagar. I want a call from Nikhil or a senior person."],
    ["AGENT", "Noted. I am passing this on now. Someone will call you within 15 minutes."],
  ]),
};
SCRIPTS["no-outcome"] = SCRIPTS.decline;

async function j(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
}
const post = (url, body, h = headers) => fetch(url, { method: "POST", headers: h, body: JSON.stringify(body) }).then(j);

console.log(`call ${callId} from ${phone} (${kind})`);

// 1. call_started
console.log("call_started:", await post(webhookUrl, { event: "call_started", call_id: callId, timestamp: new Date().toISOString(), data: { call_id: callId, status: "dialing", phone_number: phone } }, { "content-type": "application/json" }));

let booking = { type: "", slot: "", status: "none" };
let record;

if (kind === "forward") {
  const slots = await j(await fetch(`${base}/api/vaani/slots?part_of_day=evening`, { headers }));
  console.log("check_availability:", slots.speakable);
  const slot = slots.slots[0] ?? (await j(await fetch(`${base}/api/vaani/slots`, { headers }))).slots[0];
  if (slot) {
    const booked = await post(`${base}/api/vaani/book`, { start: slot.start, mode: "site visit", caller_name: "Amol Patil", caller_phone: phone }).catch((e) => ({ booked: false, error: e.message }));
    console.log("book_consultation:", booked.speakable ?? booked);
    if (booked.booked) booking = { type: "site visit", slot: slot.start, status: "confirmed" };
  }
  record = {
    outcome: booking.status === "confirmed" ? "forward" : "forward_booking_pending",
    language: "english",
    caller: { name: "Amol Patil", callback_number: phone, how_found_us: "builder referral", referrer_name: "" },
    project: { type: "residential", property: "3BHK, new possession", locality: "Kondhwa", carpet_area_sqft: 1150, current_state: "bare_shell", scope_in_callers_words: "the full home done", timeline: "move in by March 2027" },
    gate_results: { real_project: "pass", service_area: "pass", timeline: "pass", budget: "not_mentioned", decision_maker: "pass" },
    gate_notes: {},
    volunteered_budget: "",
    open_questions: [],
    pricing_asked: true,
    recovery_flag: false,
    booking,
    decline_reason: "",
    special_requests: "Evening visit preferred",
  };
} else if (kind === "decline" || kind === "no-outcome") {
  record = {
    outcome: "decline",
    language: "english",
    caller: { name: "", callback_number: phone, how_found_us: "", referrer_name: "" },
    project: { type: "residential", property: "2BHK weekend home", locality: "Lonavala", carpet_area_sqft: null, current_state: "unknown", scope_in_callers_words: "interiors", timeline: "" },
    gate_results: { real_project: "pass", service_area: "fail", timeline: "unresolved", budget: "not_mentioned", decision_maker: "unresolved" },
    gate_notes: {},
    volunteered_budget: "",
    open_questions: [],
    pricing_asked: false,
    recovery_flag: false,
    booking: { type: "", slot: "", status: "none" },
    decline_reason: "Outside Pune and PCMC: execution depends on our own contractors on site",
    special_requests: "",
  };
} else if (kind === "escalate") {
  console.log("escalate_to_human:", await post(`${base}/api/vaani/escalate`, { caller_name: "Sheetal Deshpande", callback_number: phone, designer_name: "Aryan", project_location: "Viman Nagar", senior_requested: true, details: "Designer unresponsive for five days; wants Nikhil or a senior person" }));
  record = {
    outcome: "escalate",
    language: "english",
    caller: { name: "Sheetal Deshpande", callback_number: phone, how_found_us: "", referrer_name: "" },
    project: { type: "residential", property: "2BHK (existing project)", locality: "Viman Nagar", carpet_area_sqft: null, current_state: "unknown", scope_in_callers_words: "", timeline: "" },
    gate_results: {},
    gate_notes: {},
    open_questions: [],
    pricing_asked: false,
    recovery_flag: false,
    booking: { type: "", slot: "", status: "none" },
    decline_reason: "",
    special_requests: "Asked for Nikhil or a senior person",
  };
} else {
  throw new Error(`unknown kind: ${kind}`);
}

// 4. submit_call_outcome (skipped to test the "transcript without outcome" path)
if (kind !== "no-outcome") console.log("submit_call_outcome:", await post(`${base}/api/vaani/outcome`, record));

// 5. call_postprocessing, a few seconds later in real life
const duration = kind === "forward" ? 312_000 : 95_000;
const transcript = SCRIPTS[kind];
console.log(
  "call_postprocessing:",
  await post(
    webhookUrl,
    {
      event: "call_postprocessing",
      call_id: callId,
      timestamp: new Date().toISOString(),
      data: {
        room_name: callId,
        call_id: callId,
        call_duration: duration,
        end_reason: "Call ended",
        summary: `Simulated ${kind} call.`,
        entities: { name: record?.caller?.name || "" },
        dispositions: { simulated: kind },
        recording_url: `${base}/recordings/${callId}.mp3`,
        transcript,
      },
    },
    { "content-type": "application/json" },
  ),
);
