/** Derived from Shadcn UI Kit item form-layout11 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 7). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { useCrmRequest } from "@/components/crm/request";

/** Suggests a community address from its name until the person edits the address themselves. */
export const suggestSlug = (name: string) => name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");

export function CreateCommunityDialog({ tenantId }: { tenantId: string }) {
  const t = useTranslations("CreateCommunityDialog"), screens = useTranslations("CommunityScreens"), router = useRouter(), request = useCrmRequest();
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [slug, setSlug] = useState(""), [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const result = await request<{ id: string }>(`/api/workspaces/${tenantId}/communities`, { method: "POST", body: { name: name.trim(), slug } });
    if (!result.ok) { setError(result.error); setBusy(false); return; }
    router.push(`/workspaces/${tenantId}/communities/${result.data.id}/edit`);
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button className="min-h-11"><Plus aria-hidden="true" />{t("open")}</Button></DialogTrigger>
    <DialogContent><form onSubmit={submit} className="space-y-5">
      <DialogHeader><DialogTitle>{t("title")}</DialogTitle></DialogHeader>
      <Field><FieldLabel htmlFor="new-community-name">{t("name")}</FieldLabel>
        <Input id="new-community-name" className="min-h-11" value={name} maxLength={80} required onChange={(e) => { setName(e.target.value); if (!edited) setSlug(suggestSlug(e.target.value)); }} /></Field>
      <Field><FieldLabel htmlFor="new-community-slug">{t("address")}</FieldLabel>
        <InputGroup className="min-h-11"><InputGroupAddon><InputGroupText>{screens("addressPrefix")}</InputGroupText></InputGroupAddon>
          <InputGroupInput id="new-community-slug" value={slug} maxLength={48} required pattern="[a-z0-9](?:[a-z0-9\-]{1,46}[a-z0-9])" onChange={(e) => { setEdited(true); setSlug(e.target.value.toLowerCase()); }} /></InputGroup></Field>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter><Button type="submit" className="min-h-11" disabled={busy || !name.trim() || !slug}>{t(busy ? "creating" : "create")}</Button></DialogFooter>
    </form></DialogContent>
  </Dialog>;
}
