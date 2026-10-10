import { bookedWindows } from "../repo.ts";
import { fmtDateTime } from "../format.ts";
import type { CallRow } from "../types.ts";
import { skipped, type StepResult } from "./result.ts";

// Consultation booking. Vaani calls /api/vaani/slots and /api/vaani/book as
// tools during the call, so a qualified caller leaves with a held slot even at
// 10:47pm (rubric 6.2, "can Vaani actually book?").
//
// Until a calendar is chosen, CALENDAR_PROVIDER=local holds slots in this
// app's database. To add Google Calendar / Cal.com / Outlook, implement
// CalendarProvider and register it in PROVIDERS below.

export type Slot = { start: string; end: string; label: string };

interface CalendarProvider {
  name: string;
  /** Busy windows from the external calendar, merged with locally held slots. */
  busy?(fromIso: string, toIso: string): Promise<{ start: string; end: string }[]>;
  /** Create the invite for a booked consultation. */
  createEvent?(call: CallRow): Promise<StepResult>;
}

const PROVIDERS: Record<string, CalendarProvider> = {
  local: { name: "local" },
};

function provider(): CalendarProvider {
  return PROVIDERS[(process.env.CALENDAR_PROVIDER || "local").toLowerCase()] ?? PROVIDERS.local;
}

export function calendarConfigured() {
  return provider().name !== "local";
}

const IST_OFFSET_MIN = 330;

function istParts(d: Date) {
  const shifted = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate(), dow: shifted.getUTCDay() };
}

function istToUtc(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m, d, hh, mm) - IST_OFFSET_MIN * 60_000);
}

export function slotMinutes() {
  return Number(process.env.CONSULT_SLOT_MINUTES || 60);
}

/** Open consultation slots over the next `days` working days (Mon-Sat), at least 3h out. */
export async function availableSlots(days = 5, now = new Date()): Promise<Slot[]> {
  const times = (process.env.CONSULT_SLOT_TIMES || "11:00,15:00,17:30")
    .split(",")
    .map((t) => t.trim().split(":").map(Number))
    .filter(([h, m]) => Number.isFinite(h) && Number.isFinite(m));
  const len = slotMinutes();
  const earliest = now.getTime() + 3 * 3600_000;

  const candidates: Slot[] = [];
  let cursor = new Date(now);
  let workingDays = 0;
  while (workingDays < days) {
    const p = istParts(cursor);
    if (p.dow !== 0) {
      workingDays += 1;
      for (const [hh, mm] of times) {
        const start = istToUtc(p.y, p.m, p.d, hh, mm);
        if (start.getTime() < earliest) continue;
        const end = new Date(start.getTime() + len * 60_000);
        candidates.push({ start: start.toISOString(), end: end.toISOString(), label: fmtDateTime(start.toISOString()) });
      }
    }
    cursor = new Date(cursor.getTime() + 24 * 3600_000);
  }
  if (!candidates.length) return [];

  const from = candidates[0].start;
  const to = candidates.at(-1)!.end;
  const busy = [...bookedWindows(from, to), ...((await provider().busy?.(from, to)) ?? [])];
  return candidates.filter((s) => !busy.some((b) => s.start < b.end && s.end > b.start));
}

export async function isSlotFree(startIso: string): Promise<boolean> {
  const end = new Date(new Date(startIso).getTime() + slotMinutes() * 60_000).toISOString();
  const busy = [...bookedWindows(startIso, end), ...((await provider().busy?.(startIso, end)) ?? [])];
  return busy.length === 0;
}

/** Pipeline step: turn the slot Vaani held into a real calendar invite. */
export async function confirmConsultation(call: CallRow): Promise<StepResult> {
  if (!call.booking_start) return skipped("No consultation was booked on the call");
  const p = provider();
  if (!p.createEvent) {
    return skipped(
      `Slot ${fmtDateTime(call.booking_start)} held in the app. No external calendar chosen yet (CALENDAR_PROVIDER=${p.name}).`,
    );
  }
  return p.createEvent(call);
}
