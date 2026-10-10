import { after, NextResponse } from "next/server";
import { getHold, insertCall } from "@/lib/repo";
import { processCall } from "@/lib/pipeline";
import { normaliseVaaniPayload, PayloadError, webhookAuthorised } from "@/lib/vaani";
import { slotMinutes } from "@/lib/integrations/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vaani post-call webhook. Stores the call (which is what populates the
 * dashboard), answers immediately, then runs Gemini scoring and the output
 * fan-out in the background.
 */
export async function POST(req: Request) {
  if (!webhookAuthorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  let call;
  try {
    call = normaliseVaaniPayload(body);
  } catch (err) {
    if (err instanceof PayloadError) return NextResponse.json({ error: err.message }, { status: 422 });
    throw err;
  }

  // A slot held during the call via /api/vaani/book fills in a booking the payload left out.
  const hold = getHold(call.externalId);
  if (!call.bookingStart && hold) {
    call.bookingStart = hold.start_at;
    call.bookingEnd = hold.end_at;
    call.bookingMode = call.bookingMode ?? hold.mode;
  }
  if (call.bookingStart && !call.bookingEnd) {
    call.bookingEnd = new Date(new Date(call.bookingStart).getTime() + slotMinutes() * 60_000).toISOString();
  }
  call.callerName ??= hold?.caller_name ?? null;
  call.callerPhone ??= hold?.caller_phone ?? null;

  const { id, created } = insertCall(call);
  if (created) after(() => processCall(id));

  return NextResponse.json({ ok: true, id, created, outcome: call.outcome }, { status: created ? 201 : 200 });
}
