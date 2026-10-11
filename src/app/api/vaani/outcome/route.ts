import { after, NextResponse } from "next/server";
import { ingestOutcome } from "@/lib/ingest";
import { processCall } from "@/lib/pipeline";
import { normaliseOutcomeRecord, PayloadError, webhookAuthorised } from "@/lib/vaani";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The Gemini scoring and outputs run after the response; Gemini alone can take 30s.
export const maxDuration = 120;

/**
 * Vaani tool: submit_call_outcome. The structured end-of-call record from the system prompt.
 * Stored immediately (so the dashboard has the call even if nothing else arrives); the Gemini
 * scoring and the Telegram / email / calendar / HubSpot outputs start once the post-call
 * transcript has also arrived.
 */
export async function POST(req: Request) {
  if (!webhookAuthorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  let input;
  try {
    input = normaliseOutcomeRecord(body);
  } catch (err) {
    // The agent reads this message, so say exactly what to fix.
    if (err instanceof PayloadError) return NextResponse.json({ ok: false, error: err.message }, { status: 422 });
    throw err;
  }

  const r = await ingestOutcome(input);
  if (r.runPipeline) after(() => processCall(r.id));
  return NextResponse.json({ ok: true, id: r.id, outcome: input.call.outcome });
}
