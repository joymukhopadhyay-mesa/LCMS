import Link from "next/link";
import { declineReasons, listCalls, metrics } from "@/lib/repo";
import { costs, inr } from "@/lib/cost";
import { displayName, fmtDateTime } from "@/lib/format";
import { BandPill, OutcomePill, initials } from "@/components/Pills";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

function Stat({ href, icon, tone, label, value, sub }: { href: string; icon: string; tone?: string; label: string; value: number; sub?: string }) {
  return (
    <Link href={href} className="card stat">
      <span className={`stat-icon ${tone ?? ""}`}>
        <Icon name={icon} size={28} />
      </span>
      <span>
        <span className="stat-label">{label}</span>
        <span className="stat-value" style={{ display: "block" }}>
          {value}
          {sub && <small>{sub}</small>}
        </span>
      </span>
    </Link>
  );
}

export default async function Home() {
  const m = await metrics();
  const c = costs(m);
  const pricingDue = (await listCalls({ pricingDue: true })).slice(0, 6);
  const recent = (await listCalls({ view: "all" })).slice(0, 7);
  const reasons = await declineReasons();
  const maxReason = Math.max(1, ...reasons.map((r) => r.n));
  const scored = m.hot + m.warm + m.cold;
  const pct = (n: number) => (scored ? (n / scored) * 100 : 0);
  const qualifiedRate = m.totalCalls ? Math.round((m.qualified / m.totalCalls) * 100) : 0;

  return (
    <>
      <div className="crumbs">
        <Link href="/">Home</Link> / <span>Dashboard</span>
      </div>
      <div className="page-head">
        <div>
          <h1>Welcome back, Nikhil!</h1>
          <p>
            Vaani has answered {m.totalCalls} calls, {m.afterHours} of them outside 10am–7pm.{" "}
            {m.pricingDue > 0 ? `${m.pricingDue} qualified leads are waiting for a price range.` : "Every qualified lead has a price range."}
          </p>
        </div>
        <Link href="/leads?view=pricing" className="btn">
          <Icon name="rupee" size={15} /> Add pending prices
        </Link>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat href="/calls" icon="phone" label="Calls answered" value={m.totalCalls} sub={`${m.afterHours} after hours`} />
        <Stat href="/leads" icon="check" tone="teal" label="Qualified" value={m.qualified} sub={`${qualifiedRate}%`} />
        <Stat href="/calls?view=not_qualified" icon="x" tone="grey" label="Not qualified" value={m.notQualified} sub={`${m.declined} declined · ${m.deferred} deferred`} />
        <Stat href="/leads?view=pricing" icon="rupee" tone="red" label="Pricing due" value={m.pricingDue} />
      </div>

      <section className="banner" style={{ marginBottom: 20 }}>
        <div>
          <h2>Lead temperature</h2>
          <p>Gemini&apos;s hot / warm / cold read on every qualified call. Hot gets a senior designer within the hour.</p>
          <div className="temp-bar" aria-hidden="true">
            <span style={{ width: `${pct(m.hot)}%`, background: "#ff8a73" }} />
            <span style={{ width: `${pct(m.warm)}%`, background: "#ffd27a" }} />
            <span style={{ width: `${pct(m.cold)}%`, background: "#cfe3ff" }} />
          </div>
        </div>
        <div className="banner-stats">
          <Link className="banner-stat" href="/leads?band=HOT">
            <div className="n">{m.hot}</div>
            <div className="l"><Icon name="flame" size={14} /> Hot leads</div>
          </Link>
          <Link className="banner-stat" href="/leads?band=WARM">
            <div className="n">{m.warm}</div>
            <div className="l"><Icon name="sun" size={14} /> Warm leads</div>
          </Link>
          <Link className="banner-stat" href="/leads?band=COLD">
            <div className="n">{m.cold}</div>
            <div className="l"><Icon name="snow" size={14} /> Cold leads</div>
          </Link>
          <Link className="banner-stat" href="/leads?band=UNSCORED">
            <div className="n">{m.unscored}</div>
            <div className="l"><Icon name="clock" size={14} /> Awaiting score</div>
          </Link>
        </div>
      </section>

      <div className="grid grid-main" style={{ marginBottom: 20 }}>
        <section className="card">
          <div className="card-head">
            <h2>Pricing due</h2>
            <Link href="/leads?view=pricing" className="hint">
              View all {m.pricingDue} →
            </Link>
          </div>
          {pricingDue.length === 0 ? (
            <div className="empty">Nothing waiting. New qualified leads will appear here.</div>
          ) : (
            pricingDue.map((l) => (
              <Link key={l.id} href={`/leads/${l.id}#price`} className="list-row">
                <span className="mini-avatar">{initials(displayName(l))}</span>
                <span className="grow">
                  <span className="strong">{displayName(l)}</span>{" "}
                  <span className="muted xs">· {fmtDateTime(l.received_at)}</span>
                  <span className="muted small clamp-2" style={{ display: "block" }}>
                    {l.one_line || l.brief || l.summary || "—"}
                  </span>
                </span>
                <BandPill band={l.band} />
                <span className="btn ghost sm">Add price</span>
              </Link>
            ))
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Recent calls</h2>
            <Link href="/calls" className="hint">All calls →</Link>
          </div>
          {recent.length === 0 ? (
            <div className="empty">No calls yet. Point Vaani&apos;s webhook at /api/webhooks/vaani.</div>
          ) : (
            recent.map((r) => (
              <Link key={r.id} href={`/leads/${r.id}`} className="list-row">
                <span className="grow">
                  <span className="strong small">{displayName(r)}</span>
                  <span className="muted xs" style={{ display: "block" }}>{fmtDateTime(r.received_at)}</span>
                </span>
                {r.outcome === "FORWARD" ? <BandPill band={r.band} /> : <OutcomePill outcome={r.outcome} />}
              </Link>
            ))
          )}
        </section>
      </div>

      <div className="grid grid-3">
        <section className="card">
          <div className="card-head">
            <h2>Why calls didn&apos;t qualify</h2>
            <span className="hint">Logged for every decline</span>
          </div>
          <div className="card-body">
            {reasons.length === 0 ? (
              <div className="muted small">No declines yet.</div>
            ) : (
              <div className="bars">
                {reasons.map((r) => (
                  <div className="bar-row" key={r.reason}>
                    <span className="small clamp-2" title={r.reason}>{r.reason}</span>
                    <span className="bar-track">
                      <span style={{ width: `${(r.n / maxReason) * 100}%`, background: "var(--gradient)" }} />
                    </span>
                    <span className="strong small">{r.n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Needs a human</h2>
          </div>
          <div className="card-body kv">
            <span className="k">Escalations (existing clients)</span>
            <span className="strong">{m.escalated}</span>
            <span className="k">Call-backs (missed / dropped)</span>
            <span className="strong">{m.callbacks}</span>
            <span className="k">Consultations booked on the call</span>
            <span className="strong">{m.booked}</span>
            <span className="k">After-hours calls answered</span>
            <span className="strong">{m.afterHours}</span>
          </div>
        </section>

        <Link href="/system" className="card">
          <div className="card-head">
            <h2>What the system costs</h2>
            <span className="hint">Details →</span>
          </div>
          <div className="card-body kv">
            <span className="k">Vaani call minutes</span>
            <span className="strong">{c.vaaniMinutes} min · {inr(c.vaaniInr)}</span>
            <span className="k">Gemini scoring</span>
            <span className="strong">{(c.geminiTokensIn + c.geminiTokensOut).toLocaleString("en-IN")} tokens · {inr(c.geminiInr)}</span>
            <span className="k">Total</span>
            <span className="strong">{inr(c.totalInr)}</span>
            <span className="k">Per qualified lead</span>
            <span className="strong">{inr(c.perQualifiedInr)}</span>
          </div>
        </Link>
      </div>
    </>
  );
}
