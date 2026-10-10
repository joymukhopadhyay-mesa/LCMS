"use client";

import { useTransition } from "react";
import { rerunStep } from "@/app/actions";
import type { Channel } from "@/lib/types";
import { Icon } from "./Icon";

export function RetryButton({ callId, channel, label = "Retry" }: { callId: string; channel: Channel; label?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn ghost sm"
      disabled={pending}
      onClick={() => start(() => rerunStep(callId, channel))}
    >
      <Icon name="refresh" size={13} />
      {pending ? "Running…" : label}
    </button>
  );
}
