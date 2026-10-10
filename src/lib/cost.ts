import type { Metrics } from "./repo.ts";

// Running cost of the system, from usage the app records itself. Rates come
// from env so they can follow the providers' price changes; when a rate is
// unset the dashboard shows usage only rather than a made-up rupee figure.

const num = (v: string | undefined) => (v === undefined || v.trim() === "" ? null : Number(v));

export type CostBreakdown = {
  vaaniMinutes: number;
  vaaniInr: number | null;
  geminiTokensIn: number;
  geminiTokensOut: number;
  geminiInr: number | null;
  totalInr: number | null;
  perQualifiedInr: number | null;
};

export function costs(m: Metrics): CostBreakdown {
  const vaaniRate = num(process.env.VAANI_INR_PER_MIN);
  const inRate = num(process.env.GEMINI_USD_PER_M_INPUT);
  const outRate = num(process.env.GEMINI_USD_PER_M_OUTPUT);
  const fx = num(process.env.USD_TO_INR) ?? 88;

  const vaaniMinutes = Math.round((m.callSeconds / 60) * 10) / 10;
  const vaaniInr = vaaniRate === null ? null : vaaniMinutes * vaaniRate;
  const geminiInr =
    inRate === null || outRate === null
      ? null
      : ((m.geminiInput / 1e6) * inRate + (m.geminiOutput / 1e6) * outRate) * fx;
  const totalInr = vaaniInr === null && geminiInr === null ? null : (vaaniInr ?? 0) + (geminiInr ?? 0);
  return {
    vaaniMinutes,
    vaaniInr,
    geminiTokensIn: m.geminiInput,
    geminiTokensOut: m.geminiOutput,
    geminiInr,
    totalInr,
    perQualifiedInr: totalInr !== null && m.qualified ? totalInr / m.qualified : null,
  };
}

export function inr(v: number | null): string {
  if (v === null) return "rate not set";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: v < 100 ? 2 : 0 })}`;
}
