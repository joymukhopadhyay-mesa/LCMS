import fs from "node:fs";
import path from "node:path";
import { finaliseScore, SIGNAL_IDS, SIGNALS, type ModelScoring } from "./scoring.ts";
import type { CallRow, LeadFacts, ScoreResult } from "./types.ts";

// Gemini reads one forwarded transcript and returns signals + quotes and the
// facts for the designer brief. The scoring logic file is the system
// instruction, verbatim, so editing that file changes Gemini's behaviour.

const LOGIC_FILE = path.resolve(process.cwd(), "knowledge", "Gemini-lead-scoring-logic.txt");

function systemInstruction(): string {
  const logic = fs.readFileSync(LOGIC_FILE, "utf8");
  const catalogue = Object.entries(SIGNALS)
    .map(([id, d]) => `  ${id.padEnd(40)} ${d.axis.padEnd(9)} ${d.weight > 0 ? "+" : ""}${d.weight}  ${d.label}`)
    .join("\n");
  return `${logic}

================================================================================
APPLICATION CONTRACT (overrides the OUTPUT FORMAT section above)
================================================================================

The application computes weights, totals, bands, overrides, routing and
confidence from your signals. You do NOT output scores or a band. You output:

- signals: every signal the transcript supports, using ONLY these ids. Each needs
  "evidence": a verbatim fragment of the transcript, 12 words or fewer, copied
  exactly (the app rejects quotes it cannot find). Pick at most one carpet-area
  signal and one scope signal. Omit carpet area entirely if it was never stated.

${catalogue}

- is_existing_project_complaint: true only for the T09 pattern (hard rule 7).
- gate_conflict: null, or one sentence if the transcript suggests one of Vaani's
  gates was wrong (hard rule 1).
- timeline_established: true if any completion/start timing was stated.
- not_established, open_questions, one_line_for_designer: as defined above.
  one_line_for_designer has no band label and NO digits at all.
- lead: facts for the designer brief, only what the caller said (rule 6).
  caller_name null if not given. brief: 2-3 plain sentences a designer reads
  before calling - who, what property, what scope, when, anything to handle with
  care. No price, no estimate, no band.`;
}

const responseSchema = {
  type: "OBJECT",
  properties: {
    is_existing_project_complaint: { type: "BOOLEAN" },
    gate_conflict: { type: "STRING", nullable: true },
    timeline_established: { type: "BOOLEAN" },
    signals: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          signal: { type: "STRING", enum: SIGNAL_IDS },
          evidence: { type: "STRING" },
        },
        required: ["signal", "evidence"],
      },
    },
    not_established: { type: "ARRAY", items: { type: "STRING" } },
    open_questions: { type: "ARRAY", items: { type: "STRING" } },
    one_line_for_designer: { type: "STRING" },
    lead: {
      type: "OBJECT",
      properties: {
        caller_name: { type: "STRING", nullable: true },
        locality: { type: "STRING", nullable: true },
        property_type: { type: "STRING", nullable: true },
        carpet_area: { type: "STRING", nullable: true },
        scope: { type: "STRING", nullable: true },
        timeline: { type: "STRING", nullable: true },
        source: { type: "STRING", nullable: true },
        budget_volunteered: { type: "STRING", nullable: true },
        brief: { type: "STRING" },
      },
      required: ["brief"],
    },
  },
  required: [
    "is_existing_project_complaint",
    "gate_conflict",
    "timeline_established",
    "signals",
    "not_established",
    "open_questions",
    "one_line_for_designer",
    "lead",
  ],
};

export type GeminiOutcome = {
  score: ScoreResult;
  facts: LeadFacts;
  usage: { input: number; output: number };
};

export class GeminiError extends Error {
  usage: { input: number; output: number };
  constructor(msg: string, usage = { input: 0, output: 0 }) {
    super(msg);
    this.usage = usage;
  }
}

export function geminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function scoreCall(call: CallRow): Promise<GeminiOutcome> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

  // Input contract from the logic file - and nothing else.
  const input = {
    transcript_id: call.external_id,
    transcript: call.transcript,
    channel: "phone",
    received_at: call.received_at,
    gate_results: JSON.parse(call.gate_results || "{}"),
    open_questions: JSON.parse(call.open_questions || "[]"),
    recovery_flag: Boolean(call.recovery_flag),
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction() }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
      signal: AbortSignal.timeout(90_000),
    },
  );

  const body = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    error?: { message?: string };
  };
  const usage = {
    input: body.usageMetadata?.promptTokenCount ?? 0,
    output: (body.usageMetadata?.candidatesTokenCount ?? 0) + (body.usageMetadata?.thoughtsTokenCount ?? 0),
  };
  if (!res.ok) throw new GeminiError(`Gemini ${res.status}: ${body.error?.message ?? "request failed"}`, usage);

  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let parsed: ModelScoring & { lead: LeadFacts };
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new GeminiError(
      `Gemini returned non-JSON output (finish: ${body.candidates?.[0]?.finishReason ?? "unknown"})`,
      usage,
    );
  }

  const score = finaliseScore(call.external_id, call.transcript, parsed, Boolean(call.recovery_flag));
  return { score, facts: parsed.lead, usage };
}
