import { after, NextResponse } from "next/server";
import { ingestPostCall, ingestSession } from "@/lib/ingest";
import { processCall } from "@/lib/pipeline";
import { eventName, normalisePostCall, normaliseSessionEvent, PayloadError, webhookAuthorised } from "@/lib/vaani";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The Gemini scoring and outputs run after the response; Gemini alone can take 30s.
export const maxDuration = 120;

/**
 * Vaani dashboard webhook (Settings -> Webhooks). Of Vaani's events only two matter here:
 *   call_started         remembers the caller's number against the call id
 *   call_postprocessing  transcript, summary and recording: pairs with the outcome record
 * Everything else is acknowledged and ignored. Vaani documents no signature header, so the shared
 * secret rides on the URL: https://<app>/api/webhooks/vaani?secret=...
 */
export async function POST(req: Request) {
  if (!webhookAuthorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const event = eventName(body);
  const hasTranscript = Boolean((body as { data?: { transcript?: unknown } })?.data?.transcript);

  if (event === "call_started") {
    const session = normaliseSessionEvent(body);
    if (session) await ingestSession(session);
    return NextResponse.json({ ok: true, event });
  }

  if (event === "call_postprocessing" || (!event && hasTranscript)) {
    let post;
    try {
      post = normalisePostCall(body);
    } catch (err) {
      if (err instanceof PayloadError) return NextResponse.json({ error: err.message }, { status: 422 });
      throw err;
    }
    const r = await ingestPostCall(post);
    if (r.runPipeline) after(() => processCall(r.id));
    return NextResponse.json({ ok: true, event: "call_postprocessing", id: r.id, created: r.created }, { status: r.created ? 201 : 200 });
  }

  return NextResponse.json({ ok: true, ignored: event ?? "unknown" });
}
