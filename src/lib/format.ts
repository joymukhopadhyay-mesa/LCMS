import type { CallRow, GateResults, Outcome, ScoreResult } from "./types.ts";

export const TZ = "Asia/Kolkata";

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function leadUrl(id: string, hash = ""): string {
  return `${appUrl()}/leads/${id}${hash}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** Full audit timestamp, e.g. "10 Oct 2026, 3:42:07 pm IST". */
export function fmtStamp(iso: string): string {
  return (
    new Intl.DateTimeFormat("en-IN", {
      timeZone: TZ,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(new Date(iso)) + " IST"
  );
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso),
  );
}

export function fmtDuration(sec: number | null | undefined): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export function fmtLakh(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `₹${Number.isInteger(v) ? v : v.toFixed(2).replace(/0$/, "")}L`;
}

export function fmtPriceRange(min: number | null, max: number | null): string {
  if (min === null || max === null) return "—";
  return min === max ? fmtLakh(min) : `${fmtLakh(min)} – ${fmtLakh(max)}`;
}

export function displayName(c: Pick<CallRow, "caller_name" | "locality" | "external_id">): string {
  return c.caller_name || (c.locality ? `Caller from ${c.locality}` : `Caller ${c.external_id}`);
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  FORWARD: "Qualified",
  DECLINE: "Declined",
  DEFER: "Deferred",
  ESCALATE: "Escalated",
  CALLBACK: "Call back",
};

export function parseGates(json: string | null): GateResults {
  try {
    return JSON.parse(json || "{}");
  } catch {
    return {};
  }
}

export function parseList(json: string | null): string[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function parseScore(json: string | null): ScoreResult | null {
  try {
    return json ? (JSON.parse(json) as ScoreResult) : null;
  } catch {
    return null;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Split "Speaker: text" transcript lines into turns for the chat view. */
export function parseTranscript(t: string): { speaker: string; text: string }[] {
  const turns: { speaker: string; text: string }[] = [];
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z][A-Za-z .'-]{0,24}):\s*(.*)$/);
    if (m) turns.push({ speaker: m[1].trim(), text: m[2] });
    else if (turns.length) turns[turns.length - 1].text += "\n" + line;
    else turns.push({ speaker: "", text: line });
  }
  return turns;
}

export function isAgentSpeaker(s: string): boolean {
  return /^(vaani|agent|assistant|bot|ai|front desk|studio)$/i.test(s.trim());
}
