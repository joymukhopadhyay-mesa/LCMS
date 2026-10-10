# Lead Call Management System

Aangan Studio's inbound-call pipeline: **Vaani** (voice agent) answers every call and qualifies it, **Gemini** scores the qualified ones hot / warm / cold, and the results fan out to the designers (Telegram), Nikhil (email with a price link), the calendar and HubSpot — with a dashboard on top where anyone in the studio can see every call and Nikhil can enter and revise price ranges.

Built from the MESA Case 03 pack. Source documents are in [`knowledge/`](knowledge/).

## Component map → code

| Map | Component | Where |
|---|---|---|
| Trigger | Inbound call | Vaani (external) |
| Context | Knowledge base, Rubric.txt | [`vaani/system-prompt.md`](vaani/system-prompt.md), [`knowledge/`](knowledge/) |
| Context | Lead logic (hot vs cold) | [`knowledge/Gemini-lead-scoring-logic.txt`](knowledge/Gemini-lead-scoring-logic.txt) — used verbatim as Gemini's system instruction |
| AI | Vaani → app | [`src/app/api/webhooks/vaani/route.ts`](src/app/api/webhooks/vaani/route.ts), [`src/lib/vaani.ts`](src/lib/vaani.ts); booking tools in [`src/app/api/vaani/`](src/app/api/vaani/) |
| AI | Gemini scores the transcript | [`src/lib/gemini.ts`](src/lib/gemini.ts) + deterministic rules in [`src/lib/scoring.ts`](src/lib/scoring.ts) |
| Output | Telegram brief | [`src/lib/integrations/telegram.ts`](src/lib/integrations/telegram.ts) |
| Output | Dashboard, price pending | [`src/app/`](src/app/) |
| Output | Resend email with price link | [`src/lib/integrations/email.ts`](src/lib/integrations/email.ts) |
| Output | Calendar, designer booked | [`src/lib/integrations/calendar.ts`](src/lib/integrations/calendar.ts) |
| Output | CRM lead record | [`src/lib/integrations/hubspot.ts`](src/lib/integrations/hubspot.ts) |
| Loop | Nikhil enters price range → dashboard | [`src/app/actions.ts`](src/app/actions.ts), `price_edits` table |

Orchestration is in [`src/lib/pipeline.ts`](src/lib/pipeline.ts).

### How scoring stays auditable

Gemini does the reading, the app does the arithmetic. Gemini returns signals from a fixed catalogue, each with a verbatim quote of ≤ 12 words. The app then:

- drops any signal whose quote isn't actually in the transcript (hard rule 3 — "no quote, no points"; dropped signals are shown on the lead page),
- applies the weights, caps, mutually-exclusive groups and banding from the logic file,
- applies the RECOVERY, THIN and gate-conflict overrides and computes confidence,
- strips any number from the designer one-liner (hard rule 2).

So a weight change is a code change in `scoring.ts`, not a prompt tweak, and every band can be traced to quotes. Running the seed data through the engine reproduces the logic file's calibration table on 11 of 12 calls (T11 differs because the table gives it readiness 2 while naming only one supporting signal).

## Pages

- **Dashboard** (`/`) — calls answered, qualified / not qualified, hot / warm / cold, pricing due, recent calls, decline reasons, items needing a human, running cost.
- **Leads** (`/leads`) — qualified leads: name, brief, band, consultation, and an inline price-range box (₹ lakh) that saves straight from the table and stays editable. Filters: hot / warm / cold / unscored / pricing due.
- **Lead page** (`/leads/:id`) — brief, full transcript, score breakdown with quoted evidence, Vaani's gate results, price form, **price edit log** (who, old → new, note, timestamp), and delivery status per integration with Retry.
- **All calls** (`/calls`) — every call including declines, deferrals, escalations and call-backs, with the reason.
- **System & costs** (`/system`) — which integrations are connected, the URLs to give Vaani, running cost, recent delivery failures.

No login, by design — anyone at the studio with the link can open it (see *Before going live*).

## Run it

Requires Node 22.5+ (uses the built-in `node:sqlite`; developed on Node 26).

```bash
npm install
cp .env.example .env.local      # fill in whichever keys you have
npm run seed                    # loads the 20 September phone calls as demo data
npm run dev                     # http://localhost:3000
npm run simulate                # plays Vaani: slots -> book -> post-call webhook
```

Every integration is optional. Without a key, that step is logged as *skipped* and the rest of the pipeline continues, so the app is usable before all the keys arrive.

## Environment

See [`.env.example`](.env.example). Summary:

| Variable | For |
|---|---|
| `APP_URL` | Links in Telegram/email; must be public for Vaani to reach the webhook |
| `VAANI_WEBHOOK_SECRET`, `VAANI_API_KEY` | Webhook/tool auth |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Scoring (default `gemini-2.5-flash`) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Designer brief |
| `RESEND_API_KEY`, `RESEND_FROM`, `NIKHIL_EMAIL` | Price-link email (`RESEND_FROM` must be on a verified domain) |
| `CALENDAR_PROVIDER` | `local` until a calendar is chosen |
| `HUBSPOT_ACCESS_TOKEN` | Private-app token with contacts write scope |
| `VAANI_INR_PER_MIN`, `GEMINI_USD_PER_M_INPUT/OUTPUT`, `USD_TO_INR` | Cost card; blank = show usage only |

## Vaani setup

1. Paste [`vaani/system-prompt.md`](vaani/system-prompt.md) into the agent; attach `services.md` and `qualified.md` as knowledge (not `pricing.md`).
2. Add the two tools and the post-call webhook described in [`vaani/integration.md`](vaani/integration.md).

## Before going live

- **The dashboard is open.** It shows callers' names, phone numbers and transcripts to anyone who has the URL. That's fine on a studio-only network or behind a tunnel, but a public deployment should add at least a shared passcode or IP allow-list.
- **Hosting.** Data is a local SQLite file (`data/lcms.db`). That works on a single server or VM. Serverless hosts (e.g. Vercel) have no persistent disk, so deploying there means moving `src/lib/db.ts` / `repo.ts` to Postgres (e.g. Supabase); the queries are plain SQL.
- **Vaani payload.** The webhook normaliser accepts the contract in `vaani/integration.md` plus common aliases; confirm against a real Vaani payload once the agent is set up.
- **Calendar.** Bookings are held in the app until a provider is chosen; add an adapter in `calendar.ts` (`busy()` + `createEvent()`).
- **HubSpot band.** The band and score go into the contact's note. A custom contact property (e.g. `lead_band`) would make it filterable in HubSpot — needs creating in the portal first.
