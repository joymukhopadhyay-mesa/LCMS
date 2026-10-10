# Wiring Vaani to the app

Three HTTP endpoints. All accept the shared secret as an `x-webhook-secret` header (or `Authorization: Bearer …`, or `?secret=`) when `VAANI_WEBHOOK_SECRET` is set.

| Purpose | Method | URL |
|---|---|---|
| Tool — available slots | `GET` or `POST` | `{APP_URL}/api/vaani/slots` |
| Tool — book consultation | `POST` | `{APP_URL}/api/vaani/book` |
| Post-call webhook | `POST` | `{APP_URL}/api/webhooks/vaani` |

`APP_URL` must be reachable from Vaani's servers — a deployed URL, or an ngrok / cloudflared tunnel for local testing.

## Tool 1 — `get_available_slots`

No parameters. Response:

```json
{
  "slots": [{ "start": "2026-10-12T05:30:00.000Z", "label": "12 Oct, 11:00 am" }],
  "speakable": "The earliest consultation slots are 12 Oct, 11:00 am, 12 Oct, 3:00 pm, 12 Oct, 5:30 pm."
}
```

Slots are Mon–Sat at `CONSULT_SLOT_TIMES` (IST), at least 3 hours out, minus anything already booked or held.

## Tool 2 — `book_consultation`

```json
{
  "call_id":      "string, required - Vaani's id for this call (same id the webhook will send)",
  "start":        "string, required - ISO time from get_available_slots",
  "mode":         "site visit | studio | phone",
  "caller_name":  "string, optional",
  "caller_phone": "string, optional"
}
```

Success: `{ "booked": true, "start": "…", "end": "…", "speakable": "You're booked for 12 Oct, 11:00 am…" }`
Slot gone: `{ "booked": false, "error": "slot not available", "alternatives": [...], "speakable": "That time has just gone. I can offer …" }`

The slot is **held** in the app immediately, so two callers can't take the same time. When the post-call webhook arrives with the same `call_id`, the hold becomes the lead's booking.

## Post-call webhook

Configure Vaani's post-call analysis / extraction to produce these fields and POST them as JSON. Only `call_id` is required; everything missing is shown as "not established". The normaliser in `src/lib/vaani.ts` also accepts common aliases (camelCase, fields nested under `analysis` / `extracted_data` / `variables`, transcripts as an array of `{role, content}` turns) — adjust it there once the real payload is known.

```json
{
  "call_id": "vaani-call-8f2c",
  "caller_name": "Amol Patil",
  "caller_phone": "+91 98xxx xxxxx",
  "received_at": "2026-10-10T17:12:00Z",
  "duration_sec": 312,
  "recording_url": "https://…",
  "transcript": "Vaani: …\nCaller: …",

  "outcome": "FORWARD | DECLINE | DEFER | ESCALATE | CALLBACK",
  "decline_reason": "G2 · Outside service area (Lonavala)",
  "gate_results": {
    "real_project":   "pass | pass-with-note | unresolved | fail | silent",
    "service_area":   { "verdict": "pass", "note": "Kondhwa" },
    "timeline":       "pass",
    "budget":         "silent",
    "decision_maker": { "verdict": "pass-with-note", "note": "Son calling; parents will attend" }
  },
  "open_questions": ["When would they need it complete?"],
  "recovery_flag": false,

  "locality": "Kondhwa",
  "property_type": "3BHK, bare builder handover",
  "carpet_area": "~1,150 sq ft",
  "scope": "Full home",
  "timeline": "Move in by March 2027",
  "source": "Builder referral - Rohan Lifescapes",
  "summary": "optional one-paragraph call summary",

  "booking": { "start": "2026-10-12T05:30:00Z", "end": "2026-10-12T06:30:00Z", "mode": "site visit" }
}
```

Response: `201 { ok, id, created: true, outcome }`. A retry with the same `call_id` returns `200 { created: false }` and does not re-run the pipeline.

### What happens next

1. The call is stored → it appears on the dashboard immediately (all outcomes, including declines with their reason).
2. `ESCALATE` → Telegram alert to the team. Nothing else.
3. `FORWARD` → Gemini scores the transcript against `knowledge/Gemini-lead-scoring-logic.txt`, then in parallel:
   Telegram brief to designers · email to Nikhil with the price link · calendar invite · HubSpot contact + note.
4. Each step's result (sent / skipped / failed) is logged on the lead page, with a Retry button.

## Testing without Vaani

```bash
npm run simulate
```

Runs slots → book → webhook against `http://localhost:3000` (pass another base URL as the first argument, and `decline` as the second for a declined call).
