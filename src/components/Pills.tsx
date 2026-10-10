import { OUTCOME_LABEL } from "@/lib/format";
import type { Band, Outcome } from "@/lib/types";
import { Icon } from "./Icon";

const BAND_ICON: Record<Band, string> = { HOT: "flame", WARM: "sun", COLD: "snow", ESCALATE: "alert" };

export function BandPill({ band, unscoredLabel = "Unscored" }: { band: Band | null; unscoredLabel?: string }) {
  if (!band) return <span className="pill">{unscoredLabel}</span>;
  return (
    <span className={`pill ${band}`}>
      <Icon name={BAND_ICON[band]} size={12} />
      {band}
    </span>
  );
}

export function OutcomePill({ outcome }: { outcome: Outcome }) {
  return <span className={`pill ${outcome}`}>{OUTCOME_LABEL[outcome]}</span>;
}

export function initials(name: string): string {
  const parts = name.replace(/^Caller (from )?/, "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}
