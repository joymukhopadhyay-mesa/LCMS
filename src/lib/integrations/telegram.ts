import { telegramBrief } from "../brief.ts";
import type { CallRow } from "../types.ts";
import { readError, skipped, type StepResult } from "./result.ts";

export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** Send the designer brief to the designers' Telegram chat. */
export async function sendDesignerBrief(call: CallRow): Promise<StepResult> {
  if (!telegramConfigured()) return skipped("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set");
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: telegramBrief(call),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return { status: "failed", detail: `Telegram ${await readError(res)}` };
  const body = (await res.json()) as { result?: { message_id?: number } };
  return { status: "sent", detail: `Brief posted to chat ${process.env.TELEGRAM_CHAT_ID}`, ref: String(body.result?.message_id ?? "") };
}
