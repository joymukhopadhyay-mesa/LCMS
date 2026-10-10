import { NextResponse } from "next/server";
import { availableSlots } from "@/lib/integrations/calendar";
import { webhookAuthorised } from "@/lib/vaani";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vaani tool: "get_available_slots". Returns the next open consultation slots. */
async function handle(req: Request) {
  if (!webhookAuthorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const slots = (await availableSlots(5)).slice(0, 6);
  return NextResponse.json({
    slots: slots.map((s) => ({ start: s.start, label: s.label })),
    // A ready-to-speak line for agents that read tool output aloud.
    speakable: slots.length
      ? `The earliest consultation slots are ${slots.slice(0, 3).map((s) => s.label).join(", ")}.`
      : "I don't have an open slot in the next few days - a designer will call to fix a time.",
  });
}

export const GET = handle;
export const POST = handle;
