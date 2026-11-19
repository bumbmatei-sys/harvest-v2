"use client";

import { useRef } from "react";
import { dmFailure, type DmFailure } from "@/lib/dm-view";

/** Sends a first private message. The server decides whether it is allowed and answers every refusal the same way. */
export async function startDirectMessage(slug: string, targetUserId: string, body: string, client_id: string): Promise<{ ok: true; conversationId: string } | { ok: false; failure: DmFailure }> {
  try {
    const response = await fetch(`/api/communities/${slug}/chat/dms`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetUserId, body, client_id }),
    });
    const result = await response.json().catch(() => ({})) as { outcome?: string; conversationId?: string };
    if (response.ok && result.outcome === "ok" && result.conversationId) return { ok: true, conversationId: result.conversationId };
    return { ok: false, failure: dmFailure(response.status, result.outcome) };
  } catch { return { ok: false, failure: "retry" }; }
}

/** A retry of the same text to the same place reuses one request id, so a lost answer never sends twice. `clear` after a stored send. */
export function useRetryId() {
  const last = useRef<{ key: string; id: string }>(undefined);
  const get = (key: string) => {
    if (last.current?.key !== key) last.current = { key, id: crypto.randomUUID() };
    return last.current.id;
  };
  const clear = () => { last.current = undefined; };
  return [get, clear] as const;
}

export const failureKey = { unavailable: "notAvailable", slow: "slowDownShort", signIn: "signIn", retry: "sendFailed" } as const;
