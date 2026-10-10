// Plays the part of Vaani against a running app:
//   1. asks for open consultation slots      (tool: get_available_slots)
//   2. books the first one mid-call           (tool: book_consultation)
//   3. posts the post-call webhook            (outcome FORWARD, gates, transcript)
//
//   npm run simulate                       -> against http://localhost:3000
//   npm run simulate -- https://xyz.ngrok.app
//   npm run simulate -- http://localhost:3000 decline
//
// Uses VAANI_WEBHOOK_SECRET from the environment if set.

const base = (process.argv[2] || process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const kind = process.argv[3] || "forward";
const headers = { "content-type": "application/json" };
if (process.env.VAANI_WEBHOOK_SECRET) headers["x-webhook-secret"] = process.env.VAANI_WEBHOOK_SECRET;

const callId = `SIM-${Date.now().toString(36).toUpperCase()}`;

const FORWARD = `Vaani: Namaste, Aangan Studio, this is Vaani. How can I help?
Caller: Hi, I'm Amol Patil. Our builder, Rohan Lifescapes, referred us to you.
Vaani: Thank you for calling, Amol. What are you looking to do?
Caller: We got possession of a 3BHK in Kondhwa in August. It's completely bare, builder handover. About 1,150 sq ft. We want the full home done.
Vaani: That sounds like a complete design and execution project. When would you need it complete?
Caller: We want to move in by March 2027.
Vaani: That works well with our timelines. Will anyone else be deciding on this with you?
Caller: My wife, and she's already said yes - we've been waiting to start.
Vaani: Lovely. Roughly what would something like this cost?
Caller: Yes, that's what I wanted to ask - what's your rate per square foot?
Vaani: It really follows the specification - what range did you have in mind for the full home?
Caller: I'd rather discuss it at the meeting.
Vaani: Of course. Your designer will walk you through pricing once they've seen the site. Shall I book that now?
Caller: Yes, at your earliest availability.`;

const DECLINE = `Vaani: Namaste, Aangan Studio, this is Vaani. How can I help?
Caller: Hello, I have a 2BHK in Lonavala, a weekend home. Can you do the interiors?
Vaani: Thank you for thinking of us. We only work in Pune city and PCMC - we don't have a vendor network to execute in Lonavala, so we wouldn't be the right fit.
Caller: Okay, no problem. Thanks for telling me straight.`;

async function j(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
}

let booking = null;
if (kind === "forward") {
  const slots = await j(await fetch(`${base}/api/vaani/slots`, { headers }));
  console.log("slots:", slots.speakable);
  const first = slots.slots[0];
  if (first) {
    const booked = await j(
      await fetch(`${base}/api/vaani/book`, {
        method: "POST",
        headers,
        body: JSON.stringify({ call_id: callId, start: first.start, mode: "site visit", caller_name: "Amol Patil" }),
      }),
    );
    console.log("book: ", booked.speakable);
    booking = booked.booked ? { start: booked.start, end: booked.end, mode: "site visit" } : null;
  }
}

const payload =
  kind === "forward"
    ? {
        call_id: callId,
        caller_name: "Amol Patil",
        caller_phone: "+91 98xxx xx201",
        received_at: new Date().toISOString(),
        duration_sec: 312,
        transcript: FORWARD,
        outcome: "FORWARD",
        gate_results: { real_project: "pass", service_area: "pass", timeline: "pass", budget: "silent", decision_maker: "pass" },
        open_questions: [],
        recovery_flag: false,
        locality: "Kondhwa",
        property_type: "3BHK, bare builder handover",
        carpet_area: "~1,150 sq ft",
        scope: "Full home",
        timeline: "Move in by March 2027",
        source: "Builder referral - Rohan Lifescapes",
        booking, // the app also picks up the held slot by call_id if this is omitted
      }
    : {
        call_id: callId,
        caller_phone: "+91 98xxx xx202",
        received_at: new Date().toISOString(),
        duration_sec: 95,
        transcript: DECLINE,
        outcome: "DECLINE",
        decline_reason: "G2 · Outside service area (Lonavala)",
        gate_results: { real_project: "pass", service_area: { verdict: "fail", note: "Lonavala" } },
        locality: "Lonavala",
      };

const res = await j(await fetch(`${base}/api/webhooks/vaani`, { method: "POST", headers, body: JSON.stringify(payload) }));
console.log("webhook:", res);
console.log(`open: ${base}/leads/${res.id}`);
