"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FieldValue } from "@/lib/crm-fields";
import { useCrmRequest } from "./request";

type Save = (fields: Record<string, string>) => Promise<string | null>;
type SaveCustom = (values: Record<string, FieldValue>) => Promise<string | null>;
const RecordContext = createContext<{ save: Save; saveCustom: SaveCustom; stale: boolean; writable: boolean } | null>(null);

/**
 * Owns the optimistic-concurrency version for one record so several inline fields
 * can be edited in a row without each other's saves making them stale.
 */
export function RecordProvider({ endpoint, version, writable, children }: { endpoint: string; version: number; writable: boolean; children: React.ReactNode }) {
  const crmRequest = useCrmRequest();
  const router = useRouter();
  const current = useRef(version);
  const [seen, setSeen] = useState(version);
  const [stale, setStale] = useState(false);
  // A refresh may deliver a newer server version (for example after another field saved).
  if (version !== seen) { setSeen(version); setStale(false); }
  // Built-in fields and custom fields (CRM-03) share the record's one version.
  const send = useCallback(async (url: string, body: Record<string, unknown>) => {
    const latest = Math.max(current.current, version);
    const result = await crmRequest<{ version: number }>(url, { method: "PATCH", body: { ...body, version: latest } });
    if (!result.ok) { if (result.details?.reason === "stale") setStale(true); return result.error; }
    current.current = result.data.version;
    router.refresh();
    return null;
  }, [crmRequest, router, version]);
  const save = useCallback<Save>((fields) => send(endpoint, fields), [send, endpoint]);
  const saveCustom = useCallback<SaveCustom>((values) => send(`${endpoint}/fields`, { values }), [send, endpoint]);
  return <RecordContext.Provider value={{ save, saveCustom, stale, writable }}>{children}</RecordContext.Provider>;
}
export function useRecord() {
  const value = useContext(RecordContext);
  if (!value) throw new Error("RECORD_PROVIDER_REQUIRED");
  return value;
}
