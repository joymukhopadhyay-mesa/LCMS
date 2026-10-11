import { bookedWindows } from "../repo.ts";
import { briefParts } from "../brief.ts";
import { displayName, fmtDateTime } from "../format.ts";
import type { CallRow } from "../types.ts";
import { readError, skipped, type StepResult } from "./result.ts";

// Consultation booking. Vaani calls /api/vaani/slots and /api/vaani/book as
// tools during the call, so a qualified caller leaves with a held slot even at
// 10:47pm (rubric 6.2, "can Vaani actually book?"). After the call the
// pipeline turns the hold into a real calendar invite.
//
// CALENDAR_PROVIDER=local  slots are generated from CONSULT_SLOT_TIMES and held in
//                          this app's database only (default).
// CALENDAR_PROVIDER=cal    Cal.com: open slots come from the event type's real
//                          availability, and the invite is a Cal.com booking.
//
// To add Google Calendar / Outlook, implement CalendarProvider and register it
// in PROVIDERS below.

export type Slot = { start: string; end: string; label: string };

interface CalendarProvider {
  name: string;
  /** Open start times (ISO) in [from, to) from the external calendar. Without it, slots are generated locally. */
  slots?(fromIso: string, toIso: string): Promise<string[]>;
  /** Create the invite for a booked consultation. */
  createEvent?(call: CallRow): Promise<StepResult>;
}

// ---------------------------------------------------------------- Cal.com

const CAL_API = "https://api.cal.com/v2";

function calHeaders(version: string) {
  return {
    authorization: `Bearer ${process.env.CALENDAR_API_KEY}`,
    "cal-api-version": version,
    "content-type": "application/json",
  };
}

const e164 = (p: string | null) => {
  const s = (p ?? "").replace(/[\s()-]/g, "");
  return /^\+\d{8,15}$/.test(s) ? s : null;
};

const cal: CalendarProvider = {
  name: "cal",

  async slots(fromIso, toIso) {
    const url = new URL(`${CAL_API}/slots`);
    url.searchParams.set("eventTypeId", process.env.CAL_EVENT_TYPE_ID!);
    url.searchParams.set("start", fromIso);
    url.searchParams.set("end", toIso);
    url.searchParams.set("timeZone", "Asia/Kolkata");
    const res = await fetch(url, { headers: calHeaders("2024-09-04"), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Cal.com slots ${await readError(res)}`);
    const body = (await res.json()) as { data?: Record<string, { start: string }[]> };
    return Object.values(body.data ?? {})
      .flat()
      .map((s) => new Date(s.start).toISOString())
      .sort();
  },

  async createEvent(call) {
    // Cal.com insists on an attendee email. Voice agents rarely capture one reliably,
    // so fall back to the studio's own address; the booking still lands on the calendar.
    const email = call.caller_email || process.env.CAL_FALLBACK_ATTENDEE_EMAIL || process.env.NIKHIL_EMAIL;
    if (!email) return skipped("Cal.com needs an attendee email: caller gave none and NIKHIL_EMAIL / CAL_FALLBACK_ATTENDEE_EMAIL is not set");

    const b = briefParts(call);
    const notes = [b.oneLine, ...b.facts.map(([k, v]) => `${k}: ${v}`), `Lead: ${b.url}`].filter(Boolean).join("\n");
    const phone = e164(call.caller_phone);
    const res = await fetch(`${CAL_API}/bookings`, {
      method: "POST",
      headers: calHeaders("2024-08-13"),
      body: JSON.stringify({
        start: new Date(call.booking_start!).toISOString(),
        eventTypeId: Number(process.env.CAL_EVENT_TYPE_ID),
        attendee: { name: displayName(call), email, timeZone: "Asia/Kolkata", ...(phone ? { phoneNumber: phone } : {}) },
        bookingFieldsResponses: { notes },
        metadata: { leadId: call.id, vaaniCallId: call.external_id },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { status: "failed", detail: `Cal.com booking ${await readError(res)}` };
    const body = (await res.json()) as { data?: { uid?: string } };
    const note = call.caller_email ? "" : ` (invite addressed to ${email}: no caller email captured)`;
    return { status: "sent", detail: `Booked ${fmtDateTime(call.booking_start)} on Cal.com${note}`, ref: body.data?.uid ?? null };
  },
};

const PROVIDERS: Record<string, CalendarProvider> = { local: { name: "local" }, cal };

function provider(): CalendarProvider {
  const wanted = (process.env.CALENDAR_PROVIDER || "local").toLowerCase();
  // A half-configured provider must not break the live call: use the local calendar instead.
  if (wanted === "cal" && !(process.env.CALENDAR_API_KEY && process.env.CAL_EVENT_TYPE_ID)) return PROVIDERS.local;
  return PROVIDERS[wanted] ?? PROVIDERS.local;
}

export function calendarConfigured() {
  return provider().name !== "local";
}

// ---------------------------------------------------------------- slot generation

const IST_OFFSET_MIN = 330;
const pad = (n: number) => String(n).padStart(2, "0");

function istParts(d: Date) {
  const shifted = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    dow: shifted.getUTCDay(),
    hhmm: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
  };
}

function istToUtc(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m, d, hh, mm) - IST_OFFSET_MIN * 60_000);
}

export function slotMinutes() {
  return Number(process.env.CONSULT_SLOT_MINUTES || 60);
}

function slotTimes(): string[] {
  return (process.env.CONSULT_SLOT_TIMES || "11:00,15:00,17:30")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^\d{1,2}:\d{2}$/.test(t))
    .map((t) => t.padStart(5, "0"));
}

const toSlot = (startIso: string): Slot => ({
  start: startIso,
  end: new Date(new Date(startIso).getTime() + slotMinutes() * 60_000).toISOString(),
  label: fmtDateTime(startIso),
});

/** Mon-Sat slots at CONSULT_SLOT_TIMES (IST) over the next `days` working days, at least 3h out. */
function localSlots(days: number, now: Date): Slot[] {
  const times = slotTimes().map((t) => t.split(":").map(Number));
  const earliest = now.getTime() + 3 * 3600_000;
  const out: Slot[] = [];
  let cursor = new Date(now);
  let workingDays = 0;
  while (workingDays < days) {
    const p = istParts(cursor);
    if (p.dow !== 0) {
      workingDays += 1;
      for (const [hh, mm] of times) {
        const start = istToUtc(p.y, p.m, p.d, hh, mm);
        if (start.getTime() >= earliest) out.push(toSlot(start.toISOString()));
      }
    }
    cursor = new Date(cursor.getTime() + 24 * 3600_000);
  }
  return out;
}

/** Slots from the external calendar, thinned to CONSULT_SLOT_TIMES so a caller hears a few well-spread options. */
async function externalSlots(p: CalendarProvider, days: number, now: Date): Promise<Slot[]> {
  const from = new Date(now.getTime() + 3 * 3600_000);
  const to = new Date(now.getTime() + (days + 4) * 24 * 3600_000);
  const starts = await p.slots!(from.toISOString(), to.toISOString());
  const wanted = new Set(slotTimes());
  const preferred = starts.filter((s) => wanted.has(istParts(new Date(s)).hhmm));
  const chosen = preferred.length ? preferred : starts;
  const dates = [...new Set(chosen.map((s) => istParts(new Date(s)).date))].slice(0, days);
  return chosen.filter((s) => dates.includes(istParts(new Date(s)).date)).map(toSlot);
}

export async function availableSlots(days = 5, now = new Date()): Promise<Slot[]> {
  const p = provider();
  let candidates: Slot[];
  try {
    candidates = p.slots ? await externalSlots(p, days, now) : localSlots(days, now);
  } catch (err) {
    console.error(`[calendar] ${p.name} slots failed, using local slots:`, err instanceof Error ? err.message : err);
    candidates = localSlots(days, now);
  }
  if (!candidates.length) return [];

  // Anything already booked or held through this app is taken, whichever calendar the slot came from.
  const busy = bookedWindows(candidates[0].start, candidates.at(-1)!.end);
  return candidates.filter((s) => !busy.some((b) => s.start < b.end && s.end > b.start));
}

export async function isSlotFree(startIso: string): Promise<boolean> {
  const end = new Date(new Date(startIso).getTime() + slotMinutes() * 60_000).toISOString();
  return bookedWindows(startIso, end).length === 0;
}

/** Pipeline step: turn the slot Vaani held into a real calendar invite. */
export async function confirmConsultation(call: CallRow): Promise<StepResult> {
  if (!call.booking_start) return skipped("No consultation was booked on the call");
  const p = provider();
  if (!p.createEvent) {
    return skipped(
      `Slot ${fmtDateTime(call.booking_start)} held in the app. No external calendar connected (CALENDAR_PROVIDER=${p.name}).`,
    );
  }
  return p.createEvent(call);
}
