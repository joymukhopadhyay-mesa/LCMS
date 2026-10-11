import { NextResponse } from "next/server";
import { availableSlots, isSlotFree, slotMinutes } from "@/lib/integrations/calendar";
import { getHold, holdKey, holdSlot } from "@/lib/repo";
import { fmtDateTime } from "@/lib/format";
import { webhookAuthorised } from "@/lib/vaani";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vaani tool: book_consultation. Holds a slot for the live call; the outcome record
 * (submit_call_outcome) for the same caller number turns the hold into the lead's booking.
 * Body: { start, mode?: "site visit" | "studio" | "phone", caller_name?, caller_phone, call_id? }
 * Tool calls carry no call id unless the agent is given one, so the caller's number is the key.
 */
export async function POST(req: Request) {
  if (!webhookAuthorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = (...keys: string[]) => {
    for (const k of keys) if (body[k] !== undefined && body[k] !== null && String(body[k]).trim() !== "") return String(body[k]).trim();
    return null;
  };

  const phone = s("caller_phone", "callback_number", "phone");
  const key = holdKey(phone, s("call_id", "callId"));
  const start = new Date(s("start", "slot") ?? "");
  if (!key) return NextResponse.json({ booked: false, error: "caller_phone (or call_id) is required" }, { status: 422 });
  if (Number.isNaN(start.getTime())) return NextResponse.json({ booked: false, error: "start must be a time from check_availability" }, { status: 422 });

  const startIso = start.toISOString();
  const ownHold = (await getHold(key))?.start_at === startIso;
  const offered = ownHold || (await availableSlots(10)).some((x) => x.start === startIso);
  if (!offered || (!ownHold && !(await isSlotFree(startIso)))) {
    const alternatives = (await availableSlots(5)).slice(0, 3);
    return NextResponse.json({
      booked: false,
      error: "slot not available",
      alternatives: alternatives.map((x) => ({ start: x.start, label: x.label })),
      speakable: alternatives.length
        ? `That time has just gone. I can offer ${alternatives.slice(0, 2).map((x) => x.label).join(", or ")}.`
        : "That time has just gone and there is nothing else open. Do not promise a time; say a designer will confirm one.",
    });
  }

  const end = new Date(start.getTime() + slotMinutes() * 60_000).toISOString();
  await holdSlot({
    hold_key: key,
    start_at: startIso,
    end_at: end,
    mode: s("mode", "type"),
    caller_name: s("caller_name", "name"),
    caller_phone: phone,
  });
  return NextResponse.json({
    booked: true,
    confirmation: "confirmed",
    start: startIso,
    end,
    speakable: `Booked for ${fmtDateTime(startIso)}.`,
  });
}
