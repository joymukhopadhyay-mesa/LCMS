import Link from "next/link";
import { isAfterHours, listCalls, metrics } from "@/lib/repo";
import { displayName, fmtDateTime, fmtDuration } from "@/lib/format";
import { BandPill, OutcomePill } from "@/components/Pills";
import { ClickableRow } from "@/components/ClickableRow";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

type Search = Promise<{ view?: string; q?: string }>;

export default async function CallsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const view = sp.view === "not_qualified" || sp.view === "leads" ? sp.view : "all";
  const q = sp.q?.trim() || null;
  const rows = await listCalls({ view, q });
  const m = await metrics();
  const qs = (v: string) => `/calls?${new URLSearchParams({ ...(v !== "all" ? { view: v } : {}), ...(q ? { q } : {}) })}`;

  return (
    <>
      <div className="crumbs">
        <Link href="/">Home</Link> / <span>All calls</span>
      </div>
      <div className="page-head">
        <div>
          <h1>{q ? `Calls matching “${q}”` : "All calls"}</h1>
          <p>Every call Vaani answered, including declines, deferrals, escalations and call-backs - each with the reason it ended where it did.</p>
        </div>
        {q && <Link href="/calls" className="btn ghost">Clear search</Link>}
      </div>

      <div className="chips" style={{ marginBottom: 16 }}>
        <Link href={qs("all")} className={`chip ${view === "all" ? "active" : ""}`}>All <span className="n">{m.totalCalls}</span></Link>
        <Link href={qs("leads")} className={`chip ${view === "leads" ? "active" : ""}`}>Qualified <span className="n">{m.qualified}</span></Link>
        <Link href={qs("not_qualified")} className={`chip ${view === "not_qualified" ? "active" : ""}`}>
          Not qualified &amp; other <span className="n">{m.totalCalls - m.qualified}</span>
        </Link>
      </div>

      <section className="card">
        {rows.length === 0 ? (
          <div className="empty">No calls here yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Caller</th>
                  <th>Received</th>
                  <th>Duration</th>
                  <th>Outcome</th>
                  <th>Why / brief</th>
                  <th>Lead</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <ClickableRow key={r.id} href={`/leads/${r.id}`}>
                    <td style={{ minWidth: 160 }}>
                      <Link href={`/leads/${r.id}`} className="lead-name">{displayName(r)}</Link>
                      <span className="muted xs">{r.caller_phone ?? r.external_id}</span>
                    </td>
                    <td className="small nowrap">
                      {fmtDateTime(r.received_at)}
                      {isAfterHours(r.received_at) && (
                        <span className="muted xs" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <Icon name="moon" size={12} /> after hours
                        </span>
                      )}
                    </td>
                    <td className="small nowrap">{fmtDuration(r.duration_sec)}</td>
                    <td><OutcomePill outcome={r.outcome} /></td>
                    <td style={{ minWidth: 240, maxWidth: 440 }}>
                      <span className="small clamp-2">
                        {r.outcome === "FORWARD" ? r.one_line || r.brief || r.summary : r.decline_reason || r.summary || "—"}
                      </span>
                    </td>
                    <td>{r.outcome === "FORWARD" ? <BandPill band={r.band} /> : <span className="muted">—</span>}</td>
                    <td className="muted"><Icon name="arrow" size={16} /></td>
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
