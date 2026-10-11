import { NextResponse } from "next/server";
import { availableSlots } from "@/lib/integrations/calendar";
import { webhookAuthorised } from "@/lib/vaani";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vaani tool: check_availability. Optional preferences (from the caller):
 *   preferred_date  YYYY-MM-DD   earliest day they can do
 *   part_of_day     morning | afternoon | evening
 * Returns up to four open consultation slots; the agent offers at most two at a time.
 */
async function handle(req: Request) {
  if (!webhookAuthorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const url = new URL(req.url);
  const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
  const get = (k: string) => String(body[k] ?? url.searchParams.get(k) ?? "").trim();

  const date = get("preferred_date");
  const part = get("part_of_day").toLowerCase();
  const slots = (
    await availableSlots(5, new Date(), {
      fromDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      partOfDay: part === "morning" || part === "afternoon" || part === "evening" ? part : null,
    })
  ).slice(0, 4);

  return NextResponse.json({
    slots: slots.map((s) => ({ start: s.start, label: s.label })),
    // A ready-to-speak line for agents that read tool output aloud.
    speakable: slots.length
      ? `Open consultation slots: ${slots.slice(0, 2).map((s) => s.label).join(", or ")}.`
      : "There is no open slot matching that. Do not promise a time; say a designer will confirm one.",
  });
}

export const GET = handle;
export const POST = handle;
