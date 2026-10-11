import { GeminiError, geminiConfigured, scoreCall } from "./gemini.ts";
import { getCall, logEvent, markScoringFailed, saveScore, setHubspotContact } from "./repo.ts";
import { sendDesignerBrief } from "./integrations/telegram.ts";
import { sendPriceRequest } from "./integrations/email.ts";
import { pushLead } from "./integrations/hubspot.ts";
import { confirmConsultation } from "./integrations/calendar.ts";
import type { StepResult } from "./integrations/result.ts";
import type { CallRow, Channel } from "./types.ts";

// Component map, right half:  Vaani -> Gemini -> { Telegram, Dashboard, Resend, Calendar, CRM }
// The dashboard is "populated" the moment the call row exists; everything
// else fans out in parallel and is logged per channel so a failure is visible
// on the lead page and can be retried.

const OUTPUTS: Record<Exclude<Channel, "gemini">, (c: CallRow) => Promise<StepResult & { contactId?: string }>> = {
  telegram: sendDesignerBrief,
  email: sendPriceRequest,
  calendar: confirmConsultation,
  hubspot: pushLead,
};

async function runStep(call: CallRow, channel: Exclude<Channel, "gemini">): Promise<void> {
  try {
    const r = await OUTPUTS[channel](call);
    if (channel === "hubspot" && r.contactId) await setHubspotContact(call.id, r.contactId);
    await logEvent(call.id, channel, r.status, r.detail, r.ref ?? null);
  } catch (err) {
    await logEvent(call.id, channel, "failed", err instanceof Error ? err.message : String(err));
  }
}

export async function scoreStep(callId: string): Promise<boolean> {
  const call = await getCall(callId);
  if (!call) return false;
  if (!geminiConfigured()) {
    await logEvent(callId, "gemini", "skipped", "GEMINI_API_KEY not set - lead left unscored");
    return false;
  }
  if (!call.transcript.trim()) {
    await logEvent(callId, "gemini", "skipped", "No transcript yet - Vaani's post-call message has not arrived");
    return false;
  }
  try {
    const { score, facts, usage } = await scoreCall(call);
    await saveScore(callId, score, facts, usage);
    const dropped = score.dropped_signals?.length ?? 0;
    await logEvent(
      callId,
      "gemini",
      "sent",
      `${score.band} · ${score.total}/20 (R${score.readiness.score} V${score.value.score}) · ${score.confidence} confidence` +
        (dropped ? ` · ${dropped} unquoted signal(s) dropped` : ""),
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markScoringFailed(callId, msg, err instanceof GeminiError ? err.usage : undefined);
    await logEvent(callId, "gemini", "failed", msg);
    return false;
  }
}

/** Full pipeline for one call. Safe to run in the background after the webhook has responded. */
export async function processCall(callId: string): Promise<void> {
  const call = await getCall(callId);
  if (!call) return;

  if (call.outcome === "ESCALATE") {
    // Existing-client complaint: the team hears about it now; no scoring, no CRM lead.
    await runStep(call, "telegram");
    return;
  }
  if (call.outcome !== "FORWARD") return; // declines/defers/callbacks are logged on the dashboard only

  await scoreStep(callId);
  const scored = (await getCall(callId))!;
  if (scored.band === "ESCALATE") {
    await runStep(scored, "telegram");
    return;
  }
  await Promise.all((["telegram", "email", "calendar", "hubspot"] as const).map((ch) => runStep(scored, ch)));
}

export async function retryStep(callId: string, channel: Channel): Promise<void> {
  if (channel === "gemini") {
    await scoreStep(callId);
    return;
  }
  const call = await getCall(callId);
  if (call) await runStep(call, channel);
}
