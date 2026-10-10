"use server";

import { revalidatePath } from "next/cache";
import { getCall, updatePrice } from "@/lib/repo";
import { retryStep } from "@/lib/pipeline";
import type { Channel } from "@/lib/types";

export type PriceState = { ok: boolean; error?: string; savedAt?: string };

function lakh(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").replace(/[₹,\s]/g, "").replace(/l(akh)?s?$/i, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export async function savePrice(_prev: PriceState, form: FormData): Promise<PriceState> {
  const callId = String(form.get("callId") ?? "");
  const min = lakh(form.get("min"));
  const max = lakh(form.get("max")) ?? min;
  const editedBy = String(form.get("editedBy") ?? "").trim().slice(0, 60) || "Nikhil";
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;

  const call = getCall(callId);
  if (!call) return { ok: false, error: "Lead not found" };
  if (call.outcome !== "FORWARD") return { ok: false, error: "Only qualified leads take a price range" };
  if (min === null || Number.isNaN(min) || max === null || Number.isNaN(max))
    return { ok: false, error: "Enter the range in lakh, e.g. 12 and 15" };
  if (min <= 0 || max <= 0) return { ok: false, error: "Amounts must be above zero" };
  if (min > max) return { ok: false, error: "Minimum is above maximum" };
  if (max > 10000) return { ok: false, error: "That looks too large - enter lakh, not rupees" };
  if (call.price_min_lakh === min && call.price_max_lakh === max && (call.price_note ?? null) === note)
    return { ok: true, savedAt: call.price_updated_at ?? undefined };

  updatePrice({ callId, minLakh: min, maxLakh: max, note, editedBy });
  revalidatePath("/", "layout");
  return { ok: true, savedAt: new Date().toISOString() };
}

export async function rerunStep(callId: string, channel: Channel): Promise<void> {
  await retryStep(callId, channel);
  revalidatePath("/", "layout");
}
