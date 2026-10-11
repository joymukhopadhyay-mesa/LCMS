import { after, NextResponse } from "next/server";
import { ingestEscalation } from "@/lib/ingest";
import { processCall } from "@/lib/pipeline";
import { webhookAuthorised } from "@/lib/vaani";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The Gemini scoring and outputs run after the response; Gemini alone can take 30s.
export const maxDuration = 120;

/**
 * Vaani tool: escalate_to_human, for an existing client with a problem. Records the call as an
 * escalation and alerts the team on Telegram immediately: this cannot wait for the post-call message.
 */
export async function POST(req: Request) {
  if (!webhookAuthorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = (...keys: string[]) => {
    for (const k of keys) if (body[k] !== undefined && body[k] !== null && String(body[k]).trim() !== "") return String(body[k]).trim();
    return null;
  };

  const r = await ingestEscalation({
    callId: s("call_id", "callId"),
    name: s("caller_name", "name"),
    phone: s("callback_number", "caller_phone", "phone"),
    designer: s("designer_name", "designer"),
    location: s("project_location", "location"),
    seniorRequested: /^(true|yes|1)$/i.test(s("senior_requested", "wants_senior", "asked_for_senior") ?? ""),
    details: s("details", "reason", "issue"),
  });
  if (r.runPipeline) after(() => processCall(r.id));
  return NextResponse.json({ escalated: true, id: r.id });
}
