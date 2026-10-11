# Lead Call Management System

Aangan Studio's inbound-call pipeline: **Vaani** (voice agent) answers every call and qualifies it, **Gemini** scores the qualified ones hot / warm / cold, and the results fan out to the designers (Telegram), Nikhil (email with a price link), the calendar (Cal.com) and HubSpot, with a dashboard on top where anyone in the studio can see every call and Nikhil can enter and revise price ranges.

Built from the MESA Case 03 pack. Source documents are in [`knowledge/`](knowledge/).

## Component map → code

| Map | Component | Where |
|---|---|---|
| Trigger | Inbound call | Vaani (external) |
| Context | Knowledge base, rubric | [`vaani/system-prompt.txt`](vaani/system-prompt.txt), [`knowledge/`](knowledge/) |
| Context | Lead logic (hot vs cold) | [`knowledge/Gemini-lead-scoring-logic.txt`](knowledge/Gemini-lead-scoring-logic.txt), used verbatim as Gemini's system instruction |
| AI | Vaani's four tools and post-call webhook | [`src/app/api/vaani/`](src/app/api/vaani/), [`src/app/api/webhooks/vaani/route.ts`](src/app/api/webhooks/vaani/route.ts), [`src/lib/vaani.ts`](src/lib/vaani.ts), [`src/lib/ingest.ts`](src/lib/ingest.ts) |
| AI | Gemini scores the transcript | [`src/lib/gemini.ts`](src/lib/gemini.ts) + deterministic rules in [`src/lib/scoring.ts`](src/lib/scoring.ts) |
| Output | Telegram brief | [`src/lib/integrations/telegram.ts`](src/lib/integrations/telegram.ts) |
| Output | Dashboard, price pending | [`src/app/`](src/app/) |
| Output | Resend email with price link | [`src/lib/integrations/email.ts`](src/lib/integrations/email.ts) |
| Output | Calendar, designer booked | [`src/lib/integrations/calendar.ts`](src/lib/integrations/calendar.ts) (Cal.com, or in-app slots) |
| Output | CRM lead record | [`src/lib/integrations/hubspot.ts`](src/lib/integrations/hubspot.ts) |
| Loop | Nikhil enters price range → dashboard | [`src/app/actions.ts`](src/app/actions.ts), `price_edits` table |

Orchestration is in [`src/lib/pipeline.ts`](src/lib/pipeline.ts). The call flow and the exact tool definitions to give Vaani are in [`vaani/integration.md`](vaani/integration.md).

### How a call arrives

Vaani reports one call in two messages: a **`submit_call_outcome`** tool call during the call (the structured record from the prompt: outcome, gate results, project facts, booking), and a **`call_postprocessing`** webhook afterwards (transcript, summary, recording). The app stores the outcome immediately, pairs the transcript with it when it lands, and runs the pipeline exactly once, when both halves are in. A transcript with no outcome record is kept and flagged for a human, never dropped.

### How scoring stays auditable

Gemini does the reading, the app does the arithmetic. Gemini returns signals from a fixed catalogue, each with a verbatim quote of ≤ 12 words. The app then:

- drops any signal whose quote isn't actually in the transcript (hard rule 3: "no quote, no points"; dropped signals are shown on the lead page),
- applies the weights, caps, mutually-exclusive groups and banding from the logic file,
- applies the RECOVERY, THIN and gate-conflict overrides and computes confidence,
- strips any number from the designer one-liner (hard rule 2).

So a weight change is a code change in `scoring.ts`, not a prompt tweak, and every band can be traced to quotes. With live Gemini the September calls reproduce the calibration table (T05 hot 15, T13 warm 7, T14 cold 6, T16 hot by recovery). The seed data run through the engine matches on 11 of 12 (T11 differs: the table gives it readiness 2 but names only one supporting signal).

## Pages

- **Dashboard** (`/`): calls answered, qualified / not qualified, hot / warm / cold, pricing due, recent calls, decline reasons, items needing a human, running cost.
- **Leads** (`/leads`): qualified leads with name, brief, band, consultation time and an inline price-range box (₹ lakh) that saves from the table and stays editable. Filters: hot / warm / cold / unscored / pricing due.
- **Lead page** (`/leads/:id`): brief, full transcript, score breakdown with quoted evidence, Vaani's five gate results, price form, **price edit log** (who, old → new, note, timestamp), and delivery status per integration with Retry.
- **All calls** (`/calls`): every call including declines, deferrals, escalations, call-backs and non-enquiries, with the reason.
- **System & costs** (`/system`): which integrations are connected, the URLs for Vaani, running cost, recent delivery failures.

No login, by design: anyone at the studio with the link can open it (see *Before going live*).

## Run it

Requires Node 22.9+ and a Postgres database (Neon).

```bash
npm install
cp .env.example .env.local      # DATABASE_URL (a Neon dev branch) plus whichever keys you have
npm run seed                    # loads the 20 September phone calls as demo data
npm run dev                     # http://localhost:3000
npm run simulate                # plays Vaani: slots → book → outcome → post-call
npm run clear-demo              # removes only the demo calls once Vaani is live
```

The schema is created automatically on first use. `npm run seed` truncates every table, so it refuses to run against a database that holds real calls unless you pass `--force`.

Every integration is optional. Without a key, that step is logged as *skipped* and the rest of the pipeline continues.

## Environment

See [`.env.example`](.env.example). Summary:

| Variable | For |
|---|---|
| `DATABASE_URL` | Neon pooled connection string. Use a **dev branch** locally, the production branch only in Vercel |
| `APP_URL` | Links in Telegram/email; must be public for Vaani to reach the endpoints |
| `VAANI_WEBHOOK_SECRET` | Shared secret on the tool calls (header) and the dashboard webhook (`?secret=`) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Scoring (default `gemini-3.8-flash`) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Designer brief |
| `RESEND_API_KEY`, `RESEND_FROM`, `NIKHIL_EMAIL` | Price-link email (`RESEND_FROM` must be on a verified domain) |
| `CALENDAR_PROVIDER`, `CALENDAR_API_KEY`, `CAL_EVENT_TYPE_ID`, `CONSULT_SLOT_*` | Cal.com booking (`local` = in-app slots only) |
| `HUBSPOT_ACCESS_TOKEN` | Private-app token with contacts write scope |
| `VAANI_INR_PER_MIN`, `GEMINI_USD_PER_M_INPUT/OUTPUT`, `USD_TO_INR` | Cost card; blank = show usage only |

## Vaani setup

1. Prompt: [`vaani/system-prompt.txt`](vaani/system-prompt.txt).
2. Four tools and the dashboard webhook: [`vaani/integration.md`](vaani/integration.md).

## Before going live

- **The dashboard is open.** It shows callers' names, numbers and transcripts to anyone with the URL, and "Re-score" spends Gemini tokens. Fine on a studio-only network; a public deployment should add a shared passcode.
- **The webhook secret is on a URL.** Vaani documents no signature or header option for dashboard webhooks, so `?secret=` is the only protection on that endpoint. Treat the URL like a password and rotate the secret if it leaks.
- **Cal.com needs an attendee email.** Voice agents rarely capture one reliably, so the invite goes to `NIKHIL_EMAIL` (or `CAL_FALLBACK_ATTENDEE_EMAIL`) when the caller gave none. Cal.com availability is your Cal schedule (currently Mon–Fri 9–5 IST): widen it if callers should be able to book evenings and weekends.
- **HubSpot.** The band and score go into the contact's note. Custom contact properties (band, score, price range) would make them filterable in HubSpot.
- **Demo data.** The deployed database currently holds the 20 September demo calls. Run `npm run clear-demo` against it when Vaani goes live.
