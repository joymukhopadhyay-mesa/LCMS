import { NextResponse } from "next/server";
import { availableSlots, isSlotFree, slotMinutes } from "@/lib/integrations/calendar";
import { getHold, holdSlot } from "@/lib/repo";
import { fmtDateTime } from "@/lib/format";
import { webhookAuthorised } from "@/lib/vaani";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vaani tool: "book_consultation". Holds a slot for the live call; the
 * post-call webhook (same call_id) turns the hold into the lead's booking.
 * Body: { call_id, start, mode?: "site visit" | "phone" | "studio", caller_name?, caller_phone? }
 */
export async function POST(req: Request) {
  if (!webhookAuthorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const callId = String(body.call_id ?? body.callId ?? "").trim();
  const start = new Date(String(body.start ?? body.slot ?? ""));
  if (!callId) return NextResponse.json({ booked: false, error: "call_id is required" }, { status: 422 });
  if (Number.isNaN(start.getTime())) return NextResponse.json({ booked: false, error: "start must be an ISO time" }, { status: 422 });

  const startIso = start.toISOString();
  const offered = (await availableSlots(10)).some((s) => s.start === startIso);
  const ownHold = getHold(callId)?.start_at === startIso;
  if (!ownHold && (!offered || !(await isSlotFree(startIso)))) {
    const alternatives = (await availableSlots(5)).slice(0, 3);
    return NextResponse.json({
      booked: false,
      error: "slot not available",
      alternatives: alternatives.map((s) => ({ start: s.start, label: s.label })),
      speakable: `That time has just gone. I can offer ${alternatives.map((s) => s.label).join(", ")}.`,
    });
  }

  const end = new Date(start.getTime() + slotMinutes() * 60_000).toISOString();
  holdSlot({
    external_id: callId,
    start_at: startIso,
    end_at: end,
    mode: body.mode ? String(body.mode) : null,
    caller_name: body.caller_name ? String(body.caller_name) : null,
    caller_phone: body.caller_phone ? String(body.caller_phone) : null,
  });
  return NextResponse.json({
    booked: true,
    start: startIso,
    end,
    speakable: `You're booked for ${fmtDateTime(startIso)}. A designer will have your details before then.`,
  });
}
