import Link from "next/link";
import { metrics, recentFailures } from "@/lib/repo";
import { costs, inr } from "@/lib/cost";
import { appUrl, fmtDateTime } from "@/lib/format";
import { geminiConfigured } from "@/lib/gemini";
import { telegramConfigured } from "@/lib/integrations/telegram";
import { emailConfigured } from "@/lib/integrations/email";
import { hubspotConfigured } from "@/lib/integrations/hubspot";
import { calendarConfigured } from "@/lib/integrations/calendar";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const m = await metrics();
  const c = costs(m);
  const failures = await recentFailures();
  const base = appUrl();

  const integrations = [
    { name: "Vaani webhook", icon: "phone", ok: Boolean(process.env.VAANI_WEBHOOK_SECRET), env: "VAANI_WEBHOOK_SECRET", note: "Secret check on the webhook and tool endpoints. Without it they are open." },
    { name: "Gemini", icon: "spark", ok: geminiConfigured(), env: "GEMINI_API_KEY", note: `Model: ${process.env.GEMINI_MODEL || "gemini-3.8-flash"}` },
    { name: "Telegram", icon: "send", ok: telegramConfigured(), env: "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID", note: "Designer brief" },
    { name: "Resend", icon: "mail", ok: emailConfigured(), env: "RESEND_API_KEY, RESEND_FROM, NIKHIL_EMAIL", note: "Price-link email to Nikhil" },
    { name: "Calendar", icon: "calendar", ok: calendarConfigured(), env: "CALENDAR_PROVIDER", note: calendarConfigured() ? `Provider: ${process.env.CALENDAR_PROVIDER}` : "Provider not chosen - slots are held in this app" },
    { name: "HubSpot", icon: "crm", ok: hubspotConfigured(), env: "HUBSPOT_ACCESS_TOKEN", note: "Contact upsert + brief note" },
  ];

  const endpoints = [
    ["Dashboard webhook (call_started, call_postprocessing)", "POST", "/api/webhooks/vaani?secret=…"],
    ["Tool: check_availability", "GET/POST", "/api/vaani/slots"],
    ["Tool: book_consultation", "POST", "/api/vaani/book"],
    ["Tool: escalate_to_human", "POST", "/api/vaani/escalate"],
    ["Tool: submit_call_outcome", "POST", "/api/vaani/outcome"],
  ];

  return (
    <>
      <div className="crumbs">
        <Link href="/">Home</Link> / <span>System &amp; costs</span>
      </div>
      <div className="page-head">
        <div>
          <h1>System &amp; costs</h1>
          <p>Which integrations are live, where Vaani should point, and what running this costs.</p>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        {integrations.map((i) => (
          <div className="card stat" key={i.name}>
            <span className={`stat-icon ${i.ok ? "teal" : "grey"}`}><Icon name={i.icon} size={24} /></span>
            <span style={{ minWidth: 0 }}>
              <span className="strong">{i.name}</span>{" "}
              <span className={`pill ${i.ok ? "sent" : "skipped"}`}>{i.ok ? "connected" : "not set"}</span>
              <span className="muted xs" style={{ display: "block" }}>{i.note}</span>
              {!i.ok && <span className="mono muted" style={{ display: "block" }}>{i.env}</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <section className="card">
          <div className="card-head"><h2>Running cost</h2><span className="hint">All time</span></div>
          <div className="card-body kv">
            <span className="k">Calls answered</span><span className="strong">{m.totalCalls}</span>
            <span className="k">Vaani call minutes</span><span className="strong">{c.vaaniMinutes} min · {inr(c.vaaniInr)}</span>
            <span className="k">Gemini tokens in / out</span>
            <span className="strong">{c.geminiTokensIn.toLocaleString("en-IN")} / {c.geminiTokensOut.toLocaleString("en-IN")} · {inr(c.geminiInr)}</span>
            <span className="k">Leads scored</span><span className="strong">{m.scoredCount}</span>
            <span className="k">Total</span><span className="strong">{inr(c.totalInr)}</span>
            <span className="k">Cost per qualified lead</span><span className="strong">{inr(c.perQualifiedInr)}</span>
            <span className="k">What it is generating</span>
            <span className="strong">{m.qualified} qualified · {m.hot} hot · {m.booked} consultations booked · {m.afterHours} after-hours calls caught</span>
          </div>
          <div className="card-body muted xs" style={{ paddingTop: 0 }}>
            Rates come from VAANI_INR_PER_MIN, GEMINI_USD_PER_M_INPUT / OUTPUT and USD_TO_INR in the environment. Telegram is free; Resend and HubSpot are flat-plan.
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Vaani endpoints</h2><span className="hint">Give these to the Vaani agent</span></div>
          <div className="card-body">
            <table className="data">
              <tbody>
                {endpoints.map(([label, method, path]) => (
                  <tr key={path}>
                    <td className="small">{label}<span className="muted xs" style={{ display: "block" }}>{method}</span></td>
                    <td className="mono" style={{ wordBreak: "break-all" }}>{base}{path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted xs" style={{ marginBottom: 0 }}>
              Tools send the secret as an <span className="mono">x-webhook-secret</span> header; the dashboard webhook carries it as <span className="mono">?secret=</span>. The prompt, tool definitions and payload contract are in the <span className="mono">vaani/</span> folder of the project.
            </p>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>Delivery failures</h2><span className="hint">Latest failure per lead and channel</span></div>
        {failures.length === 0 ? (
          <div className="empty">No failed deliveries.</div>
        ) : (
          failures.map((f) => (
            <Link key={f.id} href={`/leads/${f.call_id}`} className="list-row">
              <span className="pill failed">{f.channel}</span>
              <span className="grow small">
                <b>{f.caller_name ?? "Caller"}</b> · <span className="muted">{f.detail}</span>
              </span>
              <span className="muted xs nowrap">{fmtDateTime(f.created_at)}</span>
            </Link>
          ))
        )}
      </section>
    </>
  );
}
