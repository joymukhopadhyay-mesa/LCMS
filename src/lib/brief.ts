import { ROUTING_LABEL } from "./scoring.ts";
import { displayName, escapeHtml, fmtDateTime, leadUrl, parseGates, parseList, parseScore } from "./format.ts";
import { GATE_KEYS, GATE_LABELS, type CallRow } from "./types.ts";

// The designer handoff note (rubric 2.4). One builder, rendered for Telegram
// (HTML parse mode) and for email. Never contains a price.

export type BriefParts = {
  title: string;
  oneLine: string;
  facts: [string, string][];
  gates: string[];
  questions: string[];
  routing: string;
  url: string;
};

const BAND_EMOJI: Record<string, string> = { HOT: "🔥", WARM: "🌤", COLD: "❄️", ESCALATE: "🚨" };

export function briefParts(c: CallRow): BriefParts {
  const score = parseScore(c.scoring_json);
  const gates = parseGates(c.gate_results);
  const questions = [...new Set([...parseList(c.open_questions), ...(score?.open_questions ?? [])])];
  const property = [c.property_type, c.carpet_area, c.locality].filter(Boolean).join(" · ");
  const booking = c.booking_start ? `${fmtDateTime(c.booking_start)}${c.booking_mode ? ` (${c.booking_mode})` : ""}` : "Not booked on the call";
  const facts: [string, string][] = [
    ["Caller", [displayName(c), c.caller_phone].filter(Boolean).join(" · ")],
    ["Property", property || "—"],
    ["Scope", c.scope || "—"],
    ["Timeline", c.timeline || "—"],
    ["Found us via", c.source || "—"],
    ["Consultation", booking],
    ["Called at", fmtDateTime(c.received_at)],
  ];
  return {
    title: `${BAND_EMOJI[c.band ?? ""] ?? "📞"} ${c.band ?? "NEW"} lead — ${displayName(c)}`,
    oneLine: c.one_line || c.brief || c.summary || "",
    facts,
    gates: GATE_KEYS.filter((k) => gates[k]).map(
      (k) => `${GATE_LABELS[k]}: ${gates[k]!.verdict}${gates[k]!.note ? ` — ${gates[k]!.note}` : ""}`,
    ),
    questions,
    routing: ROUTING_LABEL[c.routing ?? ""] ?? "",
    url: leadUrl(c.id),
  };
}

export function telegramBrief(c: CallRow): string {
  const b = briefParts(c);
  const e = escapeHtml;
  const lines = [
    `<b>${e(b.title)}</b>`,
    b.oneLine ? `<i>${e(b.oneLine)}</i>` : null,
    "",
    ...b.facts.map(([k, v]) => `<b>${e(k)}:</b> ${e(v)}`),
    b.routing ? `\n<b>Routing:</b> ${e(b.routing)}` : null,
    b.gates.length ? `\n<b>Gates</b>\n${b.gates.map((g) => `• ${e(g)}`).join("\n")}` : null,
    b.questions.length ? `\n<b>Ask at the consultation</b>\n${b.questions.map((q) => `• ${e(q)}`).join("\n")}` : null,
    `\n<a href="${e(b.url)}">Open lead &amp; full transcript</a>`,
  ];
  // Telegram caps messages at 4096 chars.
  return lines.filter((l) => l !== null).join("\n").slice(0, 4000);
}
