"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bookmark, Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useListState } from "@/components/crm/list-state";
import { RecordPicker } from "@/components/crm/record-picker";
import { useRequest } from "@/hooks/use-request";

/** Keeps the current People filter as a saved group the Send step can pick. Lives inside the shared list state so it sees the live filter. */
export function SaveGroupButton({ tenantId }: { tenantId: string }) {
  const t = useTranslations("NewsletterAudience");
  const router = useRouter(), request = useRequest(), { state } = useListState();
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const filtered = state.filters.length > 0 || state.q !== "";
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const result = await request<{ id: string }>(`/api/workspaces/${tenantId}/newsletter/audience/groups`, { method: "POST", body: { name, state: { ...state, sources: [] } } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setOpen(false); setName("");
    router.push(`/workspaces/${tenantId}/newsletter/audience/group/${result.data.id}`);
  }
  return <>
    <Button variant="outline" disabled={!filtered} onClick={() => { setOpen(true); setError(""); }} className="min-h-11 lg:min-h-9"><Bookmark aria-hidden="true" />{t("saveGroup")}</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <DialogContent><form onSubmit={save} className="space-y-4">
        <DialogHeader><DialogTitle>{t("saveGroup")}</DialogTitle></DialogHeader>
        <Field><FieldLabel htmlFor="audience-group-name">{t("groupName")}</FieldLabel><Input id="audience-group-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required className="h-11 lg:h-9" /></Field>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)} className="min-h-11 lg:min-h-9">{t("cancel")}</Button><Button type="submit" disabled={busy || !name.trim()} className="min-h-11 lg:min-h-9">{t("save")}</Button></DialogFooter>
      </form></DialogContent>
    </Dialog>
  </>;
}

/** Picks one person at a time. Only someone with a recorded newsletter consent is added; anyone else is reported, never changed. */
export function AddToListButton({ tenantId, listId }: { tenantId: string; listId: string }) {
  const t = useTranslations("NewsletterAudience");
  const router = useRouter(), request = useRequest();
  return <RecordPicker endpoint={`/api/workspaces/${tenantId}/contacts`} toItem={(row) => ({ id: String(row.id), label: String(row.name) })}
    title={t("addPeople")} placeholder={t("searchPeople")} emptyLabel={t("noPeopleFound")}
    trigger={<Button variant="outline" className="min-h-11 lg:min-h-9"><UserPlus aria-hidden="true" />{t("addPeople")}</Button>}
    onSelect={async (item) => {
      const result = await request<{ outcomes: Record<string, string> }>(`/api/workspaces/${tenantId}/newsletter/audience/lists/${listId}/people`, { method: "POST", body: { contactIds: [item.id] } });
      if (!result.ok) return result.error;
      const outcome = result.data.outcomes[item.id];
      if (outcome === "added" || outcome === "already") { router.refresh(); return null; }
      return outcome === "needs_consent" ? t("needsConsent") : outcome === "opted_out" ? t("optedOut") : outcome === "suppressed" ? t("suppressedPerson") : t("personUnavailable");
    }} />;
}

/** Creates a list and opens it. */
export function NewListButton({ tenantId }: { tenantId: string }) {
  const t = useTranslations("NewsletterAudience");
  const router = useRouter(), request = useRequest();
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const result = await request<{ id: string }>(`/api/workspaces/${tenantId}/newsletter/audience/lists`, { method: "POST", body: { name } });
    setBusy(false);
    if (!result.ok) { setError(result.status === 409 ? t("nameTakenOrChanged") : result.error); return; }
    setOpen(false); setName("");
    router.push(`/workspaces/${tenantId}/newsletter/audience/list/${result.data.id}`);
  }
  return <>
    <Button variant="outline" onClick={() => { setOpen(true); setError(""); }} className="min-h-11 lg:min-h-9"><Plus aria-hidden="true" />{t("newList")}</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <DialogContent><form onSubmit={save} className="space-y-4">
        <DialogHeader><DialogTitle>{t("newList")}</DialogTitle></DialogHeader>
        <Field><FieldLabel htmlFor="audience-new-list-name">{t("listName")}</FieldLabel><Input id="audience-new-list-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required autoFocus className="h-11 lg:h-9" /></Field>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)} className="min-h-11 lg:min-h-9">{t("cancel")}</Button><Button type="submit" disabled={busy || !name.trim()} className="min-h-11 lg:min-h-9">{t("save")}</Button></DialogFooter>
      </form></DialogContent>
    </Dialog>
  </>;
}
