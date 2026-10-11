# Wiring Vaani to the app

The agent prompt is [`system-prompt.txt`](system-prompt.txt). It defines four tools and one end-of-call record; this page says what each tool should call.

Everything below uses your deployed URL (`APP_URL`, e.g. `https://lead-call-management-system.vercel.app`) and the shared secret `VAANI_WEBHOOK_SECRET`.

## How one call flows

```
caller dials ─► Vaani                                                    app
                │ call_started webhook ─────────────────────────────►  remember caller's number
                │ check_availability ───────────────────────────────►  open Cal.com slots
                │ book_consultation  ───────────────────────────────►  hold the slot (by caller number)
                │ submit_call_outcome ──────────────────────────────►  store the record → dashboard has the call
                │   … call ends …
                │ call_postprocessing webhook ──────────────────────►  attach transcript, then:
                                                                         Gemini score → Telegram · email · calendar · HubSpot
```

`escalate_to_human` short-circuits: the team is alerted on Telegram the moment it is called.

The outcome record arrives first (mid-call) and the transcript after. The app pairs them by call id if the agent passes one, otherwise by the caller's number (from `call_started`), otherwise by timing. If a transcript arrives with no outcome record it is kept and flagged on the dashboard ("No outcome record from Vaani") rather than dropped.

## Tools

Add each as a custom tool in the Vaani agent. Vaani takes a cURL request plus a plain-language description of when to use it. Send the secret as a header on every one: `x-webhook-secret: <VAANI_WEBHOOK_SECRET>`. Keep responses under Vaani's 2–3 second guidance: all four answer well inside it (the Gemini scoring runs later, in the background).

### check_availability

*Use when the caller is ready to book and you need open consultation times. Pass their preferred date and part of day if they gave one.*

```bash
curl -X POST "$APP_URL/api/vaani/slots" \
  -H "x-webhook-secret: $VAANI_WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"preferred_date": "<YYYY-MM-DD, optional>", "part_of_day": "<morning|afternoon|evening, optional>"}'
```

Returns `{ "slots": [{ "start": "2026-10-12T05:30:00.000Z", "label": "12 Oct, 11:00 am" }], "speakable": "…" }`. An empty `slots` list means nothing is open: the prompt already says not to promise a time.

### book_consultation

*Use once the caller has chosen one of the times from check_availability.*

```bash
curl -X POST "$APP_URL/api/vaani/book" \
  -H "x-webhook-secret: $VAANI_WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"start": "<start value from check_availability>", "mode": "<site visit|studio|phone>", "caller_name": "<name>", "caller_phone": "<callback number>"}'
```

Success: `{ "booked": true, "confirmation": "confirmed", … }`. Failure: `{ "booked": false, "alternatives": [...] }`. The caller's number is the key, so `caller_phone` is required. The slot is held immediately so two callers cannot take the same time.

### escalate_to_human

*Use for an existing client with a problem. Pass what they told you.*

```bash
curl -X POST "$APP_URL/api/vaani/escalate" \
  -H "x-webhook-secret: $VAANI_WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"caller_name": "<name>", "callback_number": "<number>", "designer_name": "<designer>", "project_location": "<locality>", "senior_requested": <true|false>, "details": "<what is wrong>"}'
```

### submit_call_outcome

*Call once before the call ends, with the full record from the prompt.*

```bash
curl -X POST "$APP_URL/api/vaani/outcome" \
  -H "x-webhook-secret: $VAANI_WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '<the JSON record from the END OF CALL section of the prompt>'
```

The body is exactly the record in the prompt (`outcome`, `language`, `caller`, `project`, `gate_results`, `gate_notes`, `volunteered_budget`, `open_questions`, `pricing_asked`, `recovery_flag`, `booking`, `decline_reason`, `special_requests`). An unrecognised `outcome` returns `422` with the allowed values so the agent can correct itself. `booking.slot` should be the `start` value from check_availability.

| `outcome` | Dashboard |
|---|---|
| `forward`, `forward_booking_pending` | Qualified lead → scored, briefed, booked |
| `defer`, `decline` | Not qualified, with `decline_reason` and the failed gate |
| `escalate` | Escalation |
| `not_an_enquiry` | Not an enquiry |

Optional: if Vaani can pass the call id into a tool call as a variable, include `"call_id": "<call id>"` in each tool body. It makes pairing exact instead of relying on the caller's number.

## Webhook (Settings → Webhooks)

Add **one** URL:

```
https://<APP_URL host>/api/webhooks/vaani?secret=<VAANI_WEBHOOK_SECRET>
```

Vaani documents no signature or custom-header option for dashboard webhooks, so the secret rides on the URL. Treat that URL as a password. The app uses two events and acknowledges the rest:

- `call_started` (caller's number → call id)
- `call_postprocessing` (`data.transcript`, `summary`, `recording_url`, `call_duration` in milliseconds, `entities`, `dispositions`)

The `[hh:mm:ss] AGENT:` / `USER:` transcript is converted to `Vaani:` / `Caller:` turns.

## Prompt variables

The prompt uses `{{current_datetime}}`, `{{caller_number}}`, `{{previous_call_context}}` and `{{escalation_window}}`. Those are filled by Vaani, not by this app. Someone must own the escalation promise: set `{{escalation_window}}` to something a human has actually committed to (see the setup notes at the top of the prompt).

## Testing without a phone

```bash
npm run simulate                    # a forwarded call: slots → book → outcome → post-call
npm run simulate -- <url> decline
npm run simulate -- <url> escalate
npm run simulate -- <url> no-outcome
```

Runs against `http://localhost:3000` by default and reads the secret from `.env.local`. Each run creates real rows in whichever database the app is pointed at, so use a dev database.
