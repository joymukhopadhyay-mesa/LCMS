import Link from "next/link";
import { listCalls, metrics } from "@/lib/repo";
import { displayName, fmtDateTime } from "@/lib/format";
import type { Band } from "@/lib/types";
import { BandPill } from "@/components/Pills";
import { ClickableRow } from "@/components/ClickableRow";
import { PriceInline } from "@/components/PriceInline";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

type Search = Promise<{ band?: string; view?: string; q?: string }>;

const BANDS = ["HOT", "WARM", "COLD", "UNSCORED"] as const;

export default async function LeadsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const band = BANDS.includes(sp.band as (typeof BANDS)[number]) ? (sp.band as Band | "UNSCORED") : null;
  const pricing = sp.view === "pricing";
  const q = sp.q?.trim() || null;
  const rows = listCalls({ view: "leads", band, pricingDue: pricing, q });
  const m = metrics();

  const chip = (label: string, href: string, active: boolean, n?: number) => (
    <Link href={href} className={`chip ${active ? "active" : ""}`}>
      {label} {n !== undefined && <span className="n">{n}</span>}
    </Link>
  );

  return (
    <>
      <div className="crumbs">
        <Link href="/">Home</Link> / <span>Leads</span>
      </div>
      <div className="page-head">
        <div>
          <h1>{pricing ? "Leads waiting for a price" : "Qualified leads"}</h1>
          <p>Every call Vaani forwarded. Tap a lead for the transcript, score breakdown and price history. Price ranges are in ₹ lakh and stay editable.</p>
        </div>
      </div>

      <div className="chips" style={{ marginBottom: 16 }}>
        {chip("All", "/leads", !band && !pricing, m.qualified)}
        {chip("Hot", "/leads?band=HOT", band === "HOT", m.hot)}
        {chip("Warm", "/leads?band=WARM", band === "WARM", m.warm)}
        {chip("Cold", "/leads?band=COLD", band === "COLD", m.cold)}
        {m.unscored > 0 && chip("Unscored", "/leads?band=UNSCORED", band === "UNSCORED", m.unscored)}
        {chip("Pricing due", "/leads?view=pricing", pricing, m.pricingDue)}
      </div>

      <section className="card">
        {rows.length === 0 ? (
          <div className="empty">{q ? `No leads match “${q}”.` : "No leads in this view yet."}</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Brief</th>
                  <th>Status</th>
                  <th>Consultation</th>
                  <th>Price range (₹ lakh)</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <ClickableRow key={r.id} href={`/leads/${r.id}`}>
                    <td style={{ minWidth: 170 }}>
                      <Link href={`/leads/${r.id}`} className="lead-name">{displayName(r)}</Link>
                      <span className="muted xs">
                        {[r.locality, fmtDateTime(r.received_at)].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td style={{ minWidth: 260, maxWidth: 420 }}>
                      <span className="small clamp-2">{r.one_line || r.brief || r.summary || "—"}</span>
                      {[r.property_type, r.carpet_area].some(Boolean) && (
                        <span className="muted xs">{[r.property_type, r.carpet_area].filter(Boolean).join(" · ")}</span>
                      )}
                    </td>
                    <td className="nowrap">
                      <BandPill band={r.band} unscoredLabel={r.scoring_status === "failed" ? "Score failed" : "Unscored"} />
                      {r.score_total !== null && r.band !== "ESCALATE" && (
                        <span className="muted xs" style={{ display: "block", marginTop: 4 }}>
                          {r.score_total}/20 · {r.confidence}
                        </span>
                      )}
                    </td>
                    <td className="small nowrap">
                      {r.booking_start ? (
                        <>
                          {fmtDateTime(r.booking_start)}
                          {r.booking_mode && <span className="muted xs" style={{ display: "block" }}>{r.booking_mode}</span>}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <PriceInline callId={r.id} min={r.price_min_lakh} max={r.price_max_lakh} />
                    </td>
                    <td className="muted">
                      <Icon name="arrow" size={16} />
                    </td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
