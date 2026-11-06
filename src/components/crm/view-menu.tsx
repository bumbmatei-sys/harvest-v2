"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronDown, Layers, RotateCcw, Save, Trash2 } from "lucide-react";
import type { ObjectType, ViewState } from "@/lib/crm-fields";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useListState } from "./list-state";
import { useCrmRequest } from "./request";

export type ViewSummary = { id: string; name: string; kind: "system" | "workspace" | "personal"; state: ViewState; version: number };

/**
 * Saved views: personal or shared with the workspace. Applying a view writes its state
 * into the URL; Update, Save as, Delete and Reset are always explicit actions.
 */
export function ViewMenu({ tenantId, objectType, views, current, modified, writable }: {
  tenantId: string; objectType: ObjectType; views: ViewSummary[]; current: ViewSummary; modified: boolean; writable: boolean;
}) {
  const t = useTranslations("Crm");
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const { state, navigate } = useListState();
  const [saveOpen, setSaveOpen] = useState(false), [deleteOpen, setDeleteOpen] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const name = (view: ViewSummary) => (view.kind === "system" ? t(`systemViews.${view.name}`) : view.name);
  const endpoint = `/api/workspaces/${tenantId}/crm/views`;
  const ownedEditable = writable && current.kind !== "system";
  async function update() {
    setBusy(true); setError("");
    const result = await crmRequest<ViewSummary>(`${endpoint}/${current.id}?object=${objectType}`, { method: "PATCH", body: { state, version: current.version } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    router.refresh();
  }
  async function saveAs(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    setBusy(true);
    const result = await crmRequest<ViewSummary>(`${endpoint}?object=${objectType}`, { method: "POST", body: { objectType, name: String(form.get("name") ?? "").trim(), shared: form.get("visibility") === "workspace", state } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setSaveOpen(false); navigate(result.data.state, { view: result.data.id });
  }
  async function remove() {
    setBusy(true); setError("");
    const result = await crmRequest(`${endpoint}/${current.id}?object=${objectType}`, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setDeleteOpen(false); navigate({ q: "", sort: "name", filters: [], columns: null, density: "comfortable" }, { view: null });
  }
  const groups = [["system", t("builtInViews")], ["workspace", t("workspaceViews")], ["personal", t("myViews")]] as const;
  return <div className="flex flex-wrap items-center gap-2">
    <ButtonGroup>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-9 max-w-64"><Layers aria-hidden="true" /><span className="truncate">{name(current)}</span>{modified && <Badge variant="secondary" className="h-5 rounded-md px-1.5 text-[11px] font-normal">{t("edited")}</Badge>}<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {groups.map(([kind, heading]) => { const list = views.filter((view) => view.kind === kind); return list.length ? <DropdownMenuGroup key={kind}>
            <DropdownMenuLabel className="text-xs text-muted-foreground">{heading}</DropdownMenuLabel>
            {list.map((view) => <DropdownMenuItem key={view.id} onSelect={() => navigate(view.state, { view: view.id })}>
              <span className="min-w-0 flex-1 truncate">{name(view)}</span>{view.id === current.id && <Check aria-hidden="true" />}
            </DropdownMenuItem>)}
          </DropdownMenuGroup> : null; })}
          {writable && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => { setError(""); setSaveOpen(true); }}><Save aria-hidden="true" />{t("saveAsNewView")}</DropdownMenuItem></>}
          {ownedEditable && <DropdownMenuItem variant="destructive" onSelect={() => { setError(""); setDeleteOpen(true); }}><Trash2 aria-hidden="true" />{t("deleteView")}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
    {modified && <>
      {ownedEditable && <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => void update()}><Save aria-hidden="true" />{t("updateView")}</Button>}
      {writable && !ownedEditable && <Button size="sm" variant="outline" className="h-9" onClick={() => { setError(""); setSaveOpen(true); }}><Save aria-hidden="true" />{t("saveAsNewView")}</Button>}
      <Button size="sm" variant="ghost" className="h-9 text-muted-foreground" onClick={() => navigate(current.state, { view: current.id })}><RotateCcw aria-hidden="true" />{t("resetToView")}</Button>
    </>}
    {error && !saveOpen && !deleteOpen && <p role="alert" className="basis-full text-xs text-destructive">{error}</p>}
    <Dialog open={saveOpen} onOpenChange={(value) => { if (!busy) setSaveOpen(value); }}>
      <DialogContent className="rounded-xl sm:max-w-[420px]">
        <DialogHeader><DialogTitle>{t("saveAsNewView")}</DialogTitle><DialogDescription>{t("saveViewDescription")}</DialogDescription></DialogHeader>
        <form onSubmit={saveAs} className="space-y-4">
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <Field className="gap-2"><FieldLabel htmlFor="view-name">{t("viewName")}</FieldLabel><Input id="view-name" name="name" required maxLength={60} defaultValue={current.kind === "system" ? "" : current.name} autoFocus /></Field>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">{t("whoCanSeeIt")}</legend>
            <RadioGroup name="visibility" defaultValue="personal" className="gap-2">
              <Label className="flex items-start gap-2 font-normal"><RadioGroupItem value="personal" className="mt-0.5" /><span><span className="block text-sm">{t("onlyMe")}</span><span className="block text-xs text-muted-foreground">{t("onlyMeHelp")}</span></span></Label>
              <Label className="flex items-start gap-2 font-normal"><RadioGroupItem value="workspace" className="mt-0.5" /><span><span className="block text-sm">{t("everyoneInWorkspace")}</span><span className="block text-xs text-muted-foreground">{t("everyoneInWorkspaceHelp")}</span></span></Label>
            </RadioGroup></fieldset>
          <DialogFooter><DialogClose asChild><Button type="button" variant="ghost" disabled={busy}>{t("cancel")}</Button></DialogClose><Button disabled={busy}>{busy ? t("saving") : t("saveView")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={deleteOpen} onOpenChange={(value) => { if (!busy) setDeleteOpen(value); }}>
      <AlertDialogContent className="rounded-xl bg-card"><AlertDialogHeader><AlertDialogTitle>{t("deleteViewTitle", { name: name(current) })}</AlertDialogTitle><AlertDialogDescription>{current.kind === "workspace" ? t("deleteSharedViewHelp") : t("deleteViewHelp")}</AlertDialogDescription></AlertDialogHeader>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>{t("cancel")}</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={(event) => { event.preventDefault(); void remove(); }}>{t("deleteView")}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
