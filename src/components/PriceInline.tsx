"use client";

import { useActionState, useEffect, useState } from "react";
import { savePrice, type PriceState } from "@/app/actions";
import { useEditorName } from "./useEditorName";

type Props = { callId: string; min: number | null; max: number | null };

/** Compact price-range box for the leads table. Saves through the same action as the lead page, so every change is logged. */
export function PriceInline({ callId, min, max }: Props) {
  const [state, action, pending] = useActionState<PriceState, FormData>(savePrice, { ok: false });
  const [editor] = useEditorName();
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (state.ok) setDirty(false);
  }, [state]);

  return (
    <form
      action={action}
      className="price-inline"
      onClick={(e) => e.stopPropagation()}
      onChange={() => setDirty(true)}
    >
      <input type="hidden" name="callId" value={callId} />
      <input type="hidden" name="editedBy" value={editor} />
      <span className="unit">₹</span>
      <input name="min" inputMode="decimal" defaultValue={min ?? ""} placeholder="min" aria-label="Minimum, lakh" />
      <span className="unit">–</span>
      <input name="max" inputMode="decimal" defaultValue={max ?? ""} placeholder="max" aria-label="Maximum, lakh" />
      <span className="unit">L</span>
      <button className={`btn sm ${min === null || dirty ? "" : "ghost"}`} disabled={pending}>
        {pending ? "…" : min === null ? "Save" : "Update"}
      </button>
      <span
        className={`status ${state.error ? "err" : state.ok && !dirty ? "ok" : ""}`}
        title={state.error ?? (state.ok ? "Saved" : "")}
        role="status"
      >
        {state.error ? "!" : state.ok && !dirty ? "✓" : ""}
      </span>
    </form>
  );
}
