import { randomBytes } from "node:crypto";
import { slotMinutes } from "./integrations/calendar.ts";
import {
  applyOutcome,
  applyTranscript,
  claimPipeline,
  consumeHold,
  findAwaitingOutcome,
  findAwaitingTranscript,
  findByExternalId,
  getCall,
  getSession,
  holdKey,
  insertCall,
  phoneKey,
  upsertSession,
} from "./repo.ts";
import type { OutcomeInput, PostCall, SessionEvent } from "./vaani.ts";
import type { CallRow, IncomingCall } from "./types.ts";

// Vaani reports one call in two messages that arrive in a fixed order:
//   1. submit_call_outcome   - a tool call during the call: the structured record
//   2. call_postprocessing   - after the call: transcript, summary, recording
// Neither carries the other's identifiers reliably (the tool call has no call id
// unless the agent is given one), so they are paired by call id when present,
// then by the caller's number, then by timing. The pipeline (Gemini scoring and
// the Telegram / email / calendar / HubSpot outputs) starts when both halves are
// in, and exactly once.

export type Ingested = { id: string; created: boolean; runPipeline: boolean };

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** Decide whether this call is ready for the pipeline and, if so, claim it so it runs once. */
async function claimIfReady(id: string): Promise<boolean> {
  const c = await getCall(id);
  if (!c) return false;
  const ready =
    (c.outcome === "ESCALATE" && c.outcome_received_at !== null) ||
    (c.outcome === "FORWARD" && c.outcome_received_at !== null && c.transcript_received_at !== null);
  return ready ? claimPipeline(id) : false;
}

const syntheticId = () => `OUT-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;

// ---------------------------------------------------------------- outcome record

export async function ingestOutcome({ callId, call }: OutcomeInput): Promise<Ingested> {
  const key = phoneKey(call.callerPhone);

  // A slot held during the call becomes the lead's booking.
  const hk = holdKey(call.callerPhone, callId);
  const hold = hk ? await consumeHold(hk) : undefined;
  if (call.outcome === "FORWARD") {
    if (hold) {
      const useHold = !call.bookingStart || call.bookingStart === hold.start_at;
      call.bookingStart = call.bookingStart ?? hold.start_at;
      call.bookingEnd = useHold ? hold.end_at : null;
      call.bookingMode = call.bookingMode ?? hold.mode;
      call.bookingStatus = call.bookingStatus && call.bookingStatus !== "none" ? call.bookingStatus : "confirmed";
      call.callerName ??= hold.caller_name;
      call.callerPhone ??= hold.caller_phone;
    }
    if (call.bookingStart && !call.bookingEnd) {
      call.bookingEnd = new Date(new Date(call.bookingStart).getTime() + slotMinutes() * 60_000).toISOString();
    }
  }

  // Find an existing row for this call.
  let existing: CallRow | undefined = callId ? await findByExternalId(callId) : undefined;
  if (!existing && key) {
    // The transcript beat the record (rare: the tool call failed and was retried), or the escalate tool already opened the row.
    const since = minutesAgo(30);
    const open = [...(await findAwaitingOutcome(since)), ...(await findAwaitingTranscript(since))];
    existing = open.find((r) => r.phone_key === key && (r.outcome_received_at === null || r.outcome === "ESCALATE"));
  }

  if (existing) {
    await applyOutcome(existing.id, call);
    return { id: existing.id, created: false, runPipeline: await claimIfReady(existing.id) };
  }

  const { id } = await insertCall({ ...call, externalId: callId ?? syntheticId() });
  return { id, created: true, runPipeline: await claimIfReady(id) };
}

// ---------------------------------------------------------------- escalate_to_human

export async function ingestEscalation(input: {
  callId: string | null;
  name: string | null;
  phone: string | null;
  designer: string | null;
  location: string | null;
  seniorRequested: boolean;
  details: string | null;
}): Promise<Ingested> {
  const reason = [
    "Existing-project complaint",
    input.designer ? `designer ${input.designer}` : null,
    input.location ? `site ${input.location}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const call: IncomingCall = {
    externalId: input.callId ?? syntheticId(),
    callerName: input.name,
    callerPhone: input.phone,
    callerEmail: null,
    receivedAt: new Date().toISOString(),
    durationSec: null,
    transcript: "",
    recordingUrl: null,
    outcome: "ESCALATE",
    declineReason: reason,
    gateResults: {},
    openQuestions: [],
    recoveryFlag: false,
    locality: input.location,
    propertyType: null,
    carpetArea: null,
    scope: null,
    timeline: null,
    source: null,
    summary: input.details ?? reason,
    specialRequests: input.seniorRequested ? "Caller asked for a senior person" : null,
    bookingStart: null,
    bookingEnd: null,
    bookingMode: null,
    outcomeReceived: true,
    transcriptReceived: false,
  };
  const { id, created } = await insertCall(call);
  return { id, created, runPipeline: await claimIfReady(id) };
}

// ---------------------------------------------------------------- call_started

export async function ingestSession(e: SessionEvent): Promise<void> {
  await upsertSession(e.callId, e.phone);
}

// ---------------------------------------------------------------- call_postprocessing

export async function ingestPostCall(post: PostCall): Promise<Ingested> {
  const phone = post.phone ?? (await getSession(post.callId))?.phone ?? null;
  const key = phoneKey(phone);
  const receivedAt =
    post.timestamp && post.durationSec
      ? new Date(new Date(post.timestamp).getTime() - post.durationSec * 1000).toISOString()
      : post.timestamp;

  let existing: CallRow | undefined = await findByExternalId(post.callId);
  if (!existing) {
    // Oldest unpaired outcome first: it belongs to the call that ended first.
    const awaiting = (await findAwaitingTranscript(minutesAgo(45))).reverse();
    existing =
      (key ? awaiting.find((r) => r.phone_key === key) : undefined) ??
      awaiting.find((r) => {
        const first = r.caller_name?.split(/\s+/)[0]?.toLowerCase();
        return Boolean(first && first.length > 2 && post.transcript.toLowerCase().includes(first));
      }) ??
      awaiting[0];
  }

  if (existing) {
    await applyTranscript(existing.id, {
      externalId: existing.external_id === post.callId ? undefined : post.callId,
      transcript: post.transcript,
      durationSec: post.durationSec,
      recordingUrl: post.recordingUrl,
      summary: post.summary,
      receivedAt,
      analysis: post.analysis,
      callerName: post.callerName,
    });
    return { id: existing.id, created: false, runPipeline: await claimIfReady(existing.id) };
  }

  // The transcript came with no outcome record. Keep it, flagged, so a person can look: never drop a call.
  const { id, created } = await insertCall({
    externalId: post.callId,
    callerName: post.callerName,
    callerPhone: phone,
    callerEmail: null,
    receivedAt: receivedAt ?? new Date().toISOString(),
    durationSec: post.durationSec,
    transcript: post.transcript,
    recordingUrl: post.recordingUrl,
    outcome: "CALLBACK",
    declineReason: "No outcome record from Vaani - read the transcript and call back if it was a real enquiry",
    gateResults: {},
    openQuestions: [],
    recoveryFlag: false,
    locality: null,
    propertyType: null,
    carpetArea: null,
    scope: null,
    timeline: null,
    source: null,
    summary: post.summary,
    bookingStart: null,
    bookingEnd: null,
    bookingMode: null,
    vaaniAnalysis: post.analysis,
    outcomeReceived: false,
    transcriptReceived: true,
  });
  return { id, created, runPipeline: false };
}
