import { briefParts } from "../brief.ts";
import { escapeHtml, leadUrl } from "../format.ts";
import type { CallRow } from "../types.ts";
import { readError, skipped, type StepResult } from "./result.ts";

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM && process.env.NIKHIL_EMAIL);
}

/** Email Nikhil the brief with a one-click link to the lead's price box. */
export async function sendPriceRequest(call: CallRow): Promise<StepResult> {
  if (!emailConfigured()) return skipped("RESEND_API_KEY / RESEND_FROM / NIKHIL_EMAIL not set");
  const b = briefParts(call);
  const url = leadUrl(call.id, "#price");
  const e = escapeHtml;
  const html = `
  <div style="font-family:Nunito,Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#363535">
    <div style="background:linear-gradient(145deg,#2794eb,#00ac9a);color:#fff;border-radius:12px;padding:20px 24px">
      <div style="font-size:13px;opacity:.85">Lead Call Management System</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">${e(b.title)}</div>
      ${b.oneLine ? `<div style="margin-top:8px;font-size:14px">${e(b.oneLine)}</div>` : ""}
    </div>
    <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px">
      ${b.facts.map(([k, v]) => `<tr><td style="padding:6px 0;color:#8a8a8a;width:130px">${e(k)}</td><td style="padding:6px 0">${e(v)}</td></tr>`).join("")}
    </table>
    ${b.questions.length ? `<p style="font-size:14px;margin:0 0 6px"><b>Open questions</b></p><ul style="font-size:14px;margin-top:0">${b.questions.map((q) => `<li>${e(q)}</li>`).join("")}</ul>` : ""}
    <p style="text-align:center;margin:26px 0">
      <a href="${e(url)}" style="background:#2794eb;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:700;display:inline-block">Enter price range</a>
    </p>
    <p style="font-size:12px;color:#8a8a8a">The price range is internal - it is for the designer and is never quoted to the caller by the voice agent.</p>
  </div>`;
  const text = [b.title, b.oneLine, "", ...b.facts.map(([k, v]) => `${k}: ${v}`), "", `Enter price range: ${url}`].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: process.env.NIKHIL_EMAIL!.split(",").map((s) => s.trim()),
      subject: `Price range needed: ${b.title.replace(/^\S+\s/, "")}`,
      html,
      text,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return { status: "failed", detail: `Resend ${await readError(res)}` };
  const body = (await res.json()) as { id?: string };
  return { status: "sent", detail: `Emailed ${process.env.NIKHIL_EMAIL}`, ref: body.id ?? null };
}
