"use client";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { errorMessage, message, type MessageKey } from "@/i18n/messages";

export type CrmResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; details?: Record<string, string | number> };

/**
 * Same-origin JSON request for CRM mutations. Errors are mapped through the message
 * catalogue so provider or database text never reaches the screen.
 */
async function crmRequest<T>(path: string, init: { method: string; body?: unknown }, fallback: MessageKey = "Errors.somethingWentWrongPleaseTryAgain"): Promise<CrmResult<T>> {
  try {
    const response = await fetch(path, { method: init.method, headers: init.body === undefined ? undefined : { "Content-Type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, status: response.status, error: errorMessage(data.error, fallback), details: data.details };
    return { ok: true, data: data as T };
  } catch { return { ok: false, status: 0, error: message("Errors.couldNotConnectPleaseTryAgain") }; }
}

/** crmRequest that sends an expired session back to sign-in. */
export function useCrmRequest() {
  const router = useRouter();
  return useCallback(async <T,>(path: string, init: { method: string; body?: unknown }, fallback?: MessageKey) => {
    const result = await crmRequest<T>(path, init, fallback);
    if (!result.ok && result.status === 401) router.replace("/sign-in");
    return result;
  }, [router]);
}
