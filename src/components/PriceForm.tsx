"use client";

import { useActionState } from "react";
import { savePrice, type PriceState } from "@/app/actions";
import { useEditorName } from "./useEditorName";

type Props = { callId: string; min: number | null; max: number | null; note: string | null };

export function PriceForm({ callId, min, max, note }: Props) {
  const [state, action, pending] = useActionState<PriceState, FormData>(savePrice, { ok: false });
  const [editor, setEditor] = useEditorName();

  return (
    <form action={action} className="stack" style={{ gap: 12 }}>
      <input type="hidden" name="callId" value={callId} />
      <div className="form-row">
        <div className="field">
          <label htmlFor="min">Min (₹ lakh)</label>
          <input id="min" name="min" inputMode="decimal" defaultValue={min ?? ""} placeholder="e.g. 12" required />
        </div>
        <div className="field">
          <label htmlFor="max">Max (₹ lakh)</label>
          <input id="max" name="max" inputMode="decimal" defaultValue={max ?? ""} placeholder="e.g. 15" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="note">Note (optional)</label>
        <textarea id="note" name="note" defaultValue={note ?? ""} placeholder="What the range assumes - spec tier, scope, site condition" />
      </div>
      <div className="form-row" style={{ alignItems: "end" }}>
        <div className="field">
          <label htmlFor="editedBy">Your name</label>
          <input id="editedBy" name="editedBy" value={editor} onChange={(e) => setEditor(e.target.value)} />
        </div>
        <button className="btn" disabled={pending} style={{ height: 40 }}>
          {pending ? "Saving…" : min === null ? "Save price range" : "Update price range"}
        </button>
      </div>
      {state.error && <div className="form-msg err">{state.error}</div>}
      {state.ok && <div className="form-msg ok">Saved and added to the edit log.</div>}
    </form>
  );
}
