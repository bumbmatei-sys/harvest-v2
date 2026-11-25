"use client";
import { useCallback } from "react";
import { useRequest } from "@/hooks/use-request";

/** Calls the Docs API of one ministry (and optionally one doc). Returns the shared request result: `{ ok, data }` or `{ ok: false, status, error }`. */
export function useDocsCall(tenantId: string, docId?: string) {
  const request = useRequest();
  const base = `/api/workspaces/${tenantId}/docs${docId ? `/${docId}` : ""}`;
  return useCallback(<T,>(method: string, path: string, body?: unknown) => request<T>(`${base}${path}`, { method, body }), [request, base]);
}
export type Person = { userId: string; name: string };
