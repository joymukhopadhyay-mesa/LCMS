import { briefParts } from "../brief.ts";
import { escapeHtml } from "../format.ts";
import type { CallRow } from "../types.ts";
import { readError, skipped, type StepResult } from "./result.ts";

const API = "https://api.hubapi.com";
const NOTE_TO_CONTACT = 202; // HubSpot-defined association type id

export function hubspotConfigured() {
  return Boolean(process.env.HUBSPOT_ACCESS_TOKEN);
}

async function hs(pathname: string, body: unknown, method = "POST") {
  return fetch(`${API}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

function splitName(name: string | null): { firstname?: string; lastname?: string } {
  if (!name) return {};
  const parts = name.trim().split(/\s+/);
  return parts.length === 1 ? { firstname: parts[0] } : { firstname: parts.slice(0, -1).join(" "), lastname: parts.at(-1) };
}

/** Upsert the caller as a HubSpot contact (matched on phone) and attach the brief as a note. */
export async function pushLead(call: CallRow): Promise<StepResult & { contactId?: string }> {
  if (!hubspotConfigured()) return skipped("HUBSPOT_ACCESS_TOKEN not set");

  const properties: Record<string, string> = {
    ...splitName(call.caller_name),
    lifecyclestage: "lead",
    hs_lead_status: "NEW",
  };
  if (call.caller_phone) properties.phone = call.caller_phone;
  if (call.caller_email) properties.email = call.caller_email;
  if (call.locality) properties.city = call.locality;
  if (!properties.firstname) properties.firstname = call.locality ? `Caller (${call.locality})` : `Caller ${call.external_id}`;

  let contactId = call.hubspot_contact_id ?? undefined;
  if (!contactId && call.caller_phone) {
    const search = await hs("/crm/v3/objects/contacts/search", {
      filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: call.caller_phone }] }],
      limit: 1,
    });
    if (search.ok) contactId = ((await search.json()) as { results?: { id: string }[] }).results?.[0]?.id;
  }

  if (contactId) {
    // Don't downgrade lifecycle on an existing contact.
    const { lifecyclestage: _l, ...update } = properties;
    const res = await hs(`/crm/v3/objects/contacts/${contactId}`, { properties: update }, "PATCH");
    if (!res.ok) return { status: "failed", detail: `HubSpot update ${await readError(res)}` };
  } else {
    const res = await hs("/crm/v3/objects/contacts", { properties });
    if (!res.ok) return { status: "failed", detail: `HubSpot create ${await readError(res)}` };
    contactId = ((await res.json()) as { id: string }).id;
  }

  const b = briefParts(call);
  const e = escapeHtml;
  const noteBody = [
    `<p><strong>${e(b.title)}</strong></p>`,
    b.oneLine ? `<p><em>${e(b.oneLine)}</em></p>` : "",
    `<p>${b.facts.map(([k, v]) => `<strong>${e(k)}:</strong> ${e(v)}`).join("<br>")}</p>`,
    call.score_total !== null ? `<p><strong>Score:</strong> ${call.score_total}/20 (readiness ${call.readiness}, value ${call.value_score}) · confidence ${e(call.confidence ?? "")}</p>` : "",
    b.gates.length ? `<p>${b.gates.map(e).join("<br>")}</p>` : "",
    `<p><a href="${e(b.url)}">Full transcript in Lead Call Management System</a></p>`,
  ].join("");
  const note = await hs("/crm/v3/objects/notes", {
    properties: { hs_timestamp: new Date().toISOString(), hs_note_body: noteBody },
    associations: [
      { to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: NOTE_TO_CONTACT }] },
    ],
  });
  if (!note.ok) return { status: "failed", detail: `HubSpot note ${await readError(note)}`, contactId };

  return { status: "sent", detail: `Contact ${contactId} upserted, brief attached as note`, ref: contactId, contactId };
}
