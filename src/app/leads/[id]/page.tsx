import Link from "next/link";
import { notFound } from "next/navigation";
import { getCall, isAfterHours, latestEvents, listPriceEdits } from "@/lib/repo";
import {
  displayName,
  fmtDateTime,
  fmtDuration,
  fmtPriceRange,
  fmtStamp,
  isAgentSpeaker,
  parseGates,
  parseList,
  parseScore,
  parseTranscript,
} from "@/lib/format";
import { ROUTING_LABEL, SIGNALS } from "@/lib/scoring";
import { GATE_KEYS, GATE_LABELS, type Channel, type ScoredSignal } from "@/lib/types";
import { BandPill, OutcomePill, initials } from "@/components/Pills";
import { PriceForm } from "@/components/PriceForm";
import { RetryButton } from "@/components/RetryButton";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

const CHANNELS: { key: Channel; label: string; icon: string }[] = [
  { key: "gemini", label: "Gemini scoring", icon: "spark" },
  { key: "telegram", label: "Telegram brief to designer", icon: "send" },
  { key: "email", label: "Email to Nikhil (price link)", icon: "mail" },
  { key: "calendar", label: "Calendar invite", icon: "calendar" },
  { key: "hubspot", label: "HubSpot CRM", icon: "crm" },
];

function Signals({ list }: { list: ScoredSignal[] }) {
  if (!list.length) return <div className="muted small">No signals.</div>;
  return (
    <div>
      {list.map((s) => (
        <div className="signal" key={s.signal}>
          <span className={`w ${s.weight < 0 ? "neg" : ""}`}>{s.weight > 0 ? `+${s.weight}` : s.weight}</span>
          <span>
            {SIGNALS[s.signal]?.label ?? s.signal}
            {s.evidence && (
              <>
                <br />
                <q>{s.evidence}</q>
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getCall(id);
  if (!c) notFound();

  const name = displayName(c);
  const score = parseScore(c.scoring_json);
  const gates = parseGates(c.gate_results);
  const questions = [...new Set([...parseList(c.open_questions), ...(score?.open_questions ?? [])])];
  const turns = parseTranscript(c.transcript);
  const edits = listPriceEdits(c.id);
  const events = latestEvents(c.id);
  const qualified = c.outcome === "FORWARD";

  const facts: [string, string | null][] = [
    ["Property", c.property_type],
    ["Carpet area", c.carpet_area],
    ["Locality", c.locality],
    ["Scope", c.scope],
    ["Timeline", c.timeline],
    ["Found us via", c.source],
    ["Consultation", c.booking_start ? `${fmtDateTime(c.booking_start)}${c.booking_mode ? ` · ${c.booking_mode}` : ""}` : null],
    ["Phone", c.caller_phone],
  ];

  return (
    <>
      <div className="crumbs">
        <Link href="/">Home</Link> / <Link href={qualified ? "/leads" : "/calls"}>{qualified ? "Leads" : "All calls"}</Link> /{" "}
        <span>{name}</span>
      </div>

      <section className="card card-body" style={{ marginBottom: 20 }}>
        <div className="lead-hero">
          <span className="avatar">{initials(name)}</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <h1>{name}</h1>
              {qualified ? <BandPill band={c.band} /> : <OutcomePill outcome={c.outcome} />}
              {qualified && <OutcomePill outcome={c.outcome} />}
            </div>
            <div className="meta">
              {c.caller_phone && <span><Icon name="phone" size={13} /> {c.caller_phone}</span>}
              <span><Icon name="clock" size={13} /> {fmtDateTime(c.received_at)} · {fmtDuration(c.duration_sec)}</span>
              {isAfterHours(c.received_at) && <span><Icon name="moon" size={13} /> After hours</span>}
              <span className="mono">{c.external_id}</span>
            </div>
            {c.routing && <div className="small" style={{ marginTop: 8 }}><b>Routing:</b> {ROUTING_LABEL[c.routing] ?? c.routing}</div>}
            {!qualified && c.decline_reason && <div className="small" style={{ marginTop: 8 }}><b>Reason:</b> {c.decline_reason}</div>}
          </div>
          {score && c.band !== "ESCALATE" && (
            <div style={{ textAlign: "right" }}>
              <div className="stat-value">{score.total}<small>/20</small></div>
              <div className="muted xs">readiness {score.readiness.score} · value {score.value.score} · {score.confidence} confidence</div>
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-main">
        <div className="stack">
          <section className="card">
            <div className="card-head"><h2>Brief</h2><span className="hint">What the designer sees first</span></div>
            <div className="card-body">
              {c.one_line && <div className="one-line">{c.one_line}</div>}
              {(c.brief || c.summary) && <p style={{ marginTop: 0 }}>{c.brief || c.summary}</p>}
              <div className="facts">
                {facts.map(([k, v]) => (
                  <div className="fact" key={k}>
                    <div className="k">{k}</div>
                    <div className="v">{v || <span className="muted">Not established</span>}</div>
                  </div>
                ))}
              </div>
              {questions.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, margin: "20px 0 6px" }}>Ask at the consultation</h3>
                  <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
                    {questions.map((q) => <li key={q}>{q}</li>)}
                  </ul>
                </>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Call transcript</h2>
              {c.recording_url && <a href={c.recording_url} target="_blank" rel="noreferrer" className="hint">Recording ↗</a>}
            </div>
            <div className="card-body">
              {turns.length === 0 ? (
                <div className="muted small">No transcript - the call was missed or dropped before anything was said.</div>
              ) : (
                <div className="transcript">
                  {turns.map((t, i) => {
                    const kind = !t.speaker ? "plain" : isAgentSpeaker(t.speaker) ? "agent" : "caller";
                    return (
                      <div key={i} className={`turn ${kind}`}>
                        {t.speaker && <div className="who">{t.speaker}</div>}
                        {t.text}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {qualified && (
            <section className="card">
              <div className="card-head">
                <h2>Why this band</h2>
                <RetryButton callId={c.id} channel="gemini" label={score ? "Re-score" : "Score now"} />
              </div>
              <div className="card-body">
                {!score ? (
                  <div className="muted small">
                    {c.scoring_status === "failed" ? `Scoring failed: ${c.scoring_error}` : "Not scored yet."}
                  </div>
                ) : (
                  <>
                    {score.source === "calibration_table" && (
                      <div className="notice">
                        <Icon name="alert" size={16} />
                        <span>Seeded from the September calibration table in the scoring logic. Re-score to have Gemini cite the transcript signal by signal.</span>
                      </div>
                    )}
                    {score.band === "ESCALATE" ? (
                      <div className="small">Existing-project complaint - scoring stopped and the team was alerted.</div>
                    ) : (
                      <>
                        <div className="score-axis">
                          <div className="axis-head"><b>Readiness</b><span>{score.readiness.score}/10</span></div>
                          <div className="meter"><span style={{ width: `${score.readiness.score * 10}%` }} /></div>
                          <Signals list={score.readiness.signals} />
                        </div>
                        <div className="score-axis">
                          <div className="axis-head"><b>Value</b><span>{score.value.score}/10</span></div>
                          <div className="meter"><span style={{ width: `${score.value.score * 10}%` }} /></div>
                          <Signals list={score.value.signals} />
                        </div>
                      </>
                    )}
                    <div className="kv" style={{ marginTop: 14 }}>
                      {score.overrides_applied.length > 0 && (<><span className="k">Overrides</span><span>{score.overrides_applied.join(", ")}</span></>)}
                      <span className="k">Confidence</span><span>{score.confidence}</span>
                      {score.not_established.length > 0 && (<><span className="k">Not established</span><span>{score.not_established.join(", ").replaceAll("_", " ")}</span></>)}
                      {c.scored_at && (<><span className="k">Scored</span><span>{fmtDateTime(c.scored_at)}</span></>)}
                    </div>
                    {score.dropped_signals && score.dropped_signals.length > 0 && (
                      <details style={{ marginTop: 12 }} className="small">
                        <summary className="muted">{score.dropped_signals.length} signal(s) Gemini proposed without a valid quote - not scored</summary>
                        {score.dropped_signals.map((d, i) => (
                          <div key={i} className="signal"><span className="w neg">0</span><span>{SIGNALS[d.signal]?.label ?? d.signal} — {d.reason}<br /><q>{d.evidence}</q></span></div>
                        ))}
                      </details>
                    )}
                  </>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="stack">
          <section className="card" id="price">
            <div className="card-head"><h2>Price range</h2><span className="hint">Internal · never quoted by Vaani</span></div>
            <div className="card-body">
              {qualified ? (
                <>
                  <div className="price-now">{fmtPriceRange(c.price_min_lakh, c.price_max_lakh)}</div>
                  <div className="muted xs" style={{ marginBottom: 14 }}>
                    {c.price_updated_at ? `Last updated ${fmtDateTime(c.price_updated_at)}` : "No price range yet"}
                    {c.price_note ? ` · ${c.price_note}` : ""}
                  </div>
                  <PriceForm callId={c.id} min={c.price_min_lakh} max={c.price_max_lakh} note={c.price_note} />
                </>
              ) : (
                <div className="muted small">Only qualified leads take a price range. This call ended as “{c.outcome.toLowerCase()}”.</div>
              )}
            </div>
          </section>

          {qualified && (
            <section className="card">
              <div className="card-head"><h2>Price edit log</h2><span className="hint">{edits.length} change{edits.length === 1 ? "" : "s"}</span></div>
              <div className="card-body">
                {edits.length === 0 ? (
                  <div className="muted small">No edits yet. Every save is recorded here with its timestamp.</div>
                ) : (
                  <ul className="timeline">
                    {edits.map((e) => (
                      <li key={e.id}>
                        <div>
                          <b>{e.edited_by}</b>{" "}
                          {e.old_min_lakh === null ? "set" : "changed"} the range{" "}
                          {e.old_min_lakh !== null && <span className="muted">{fmtPriceRange(e.old_min_lakh, e.old_max_lakh)} → </span>}
                          <b>{fmtPriceRange(e.new_min_lakh, e.new_max_lakh)}</b>
                        </div>
                        {e.note && <div className="muted">“{e.note}”</div>}
                        <div className="when">{fmtStamp(e.edited_at)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-head"><h2>Vaani&apos;s gate results</h2></div>
            <div className="card-body gate-list">
              {GATE_KEYS.map((k) => (
                <div className="gate" key={k}>
                  <span>
                    {GATE_LABELS[k]}
                    {gates[k]?.note && <div className="note">{gates[k]!.note}</div>}
                  </span>
                  <span className={`pill ${gates[k]?.verdict ?? "not-reached"}`}>{gates[k]?.verdict ?? "not reached"}</span>
                </div>
              ))}
              {c.recovery_flag ? <div className="note small" style={{ marginTop: 8 }}>⚠ Recovery: this caller enquired before and heard nothing.</div> : null}
            </div>
          </section>

          {(qualified || c.outcome === "ESCALATE") && (
            <section className="card">
              <div className="card-head"><h2>Delivery</h2><span className="hint">Outputs after the call</span></div>
              <div className="card-body" style={{ paddingTop: 6, paddingBottom: 6 }}>
                {CHANNELS.filter((ch) => qualified || ch.key === "telegram").map((ch) => {
                  const e = events[ch.key];
                  return (
                    <div className="delivery" key={ch.key}>
                      <span className="ic"><Icon name={ch.icon} size={17} /></span>
                      <div className="body">
                        <div className="strong">{ch.label}</div>
                        <div className="detail">{e ? `${e.detail ?? ""} · ${fmtDateTime(e.created_at)}` : "Not run yet"}</div>
                      </div>
                      <span className={`pill ${e?.status ?? "skipped"}`}>{e?.status ?? "pending"}</span>
                      {ch.key !== "gemini" && e?.status !== "sent" && <RetryButton callId={c.id} channel={ch.key} label={e ? "Retry" : "Run"} />}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
