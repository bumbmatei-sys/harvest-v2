/** Derived from Shadcn UI Kit item list-block29 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Giving screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowUp,
  HandCoins,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormSection } from "@/components/form-section";
import { WaysToGive } from "@/components/giving/ways-to-give";
import { GivingMark } from "@/components/giving/giving-logos";
import { MethodDialog, fromMethod, toInput } from "@/components/giving/ways-to-give-method-dialog";
import { useRequest } from "@/hooks/use-request";
import { givingLimits } from "@/lib/ways-to-give";
import type { GivingMethod, GivingStanding } from "@/server/ways-to-give";

const summary = (m: GivingMethod) => m.iban ? `${m.iban.slice(0, 4)} •••• ${m.iban.slice(-4)}` : m.handle ?? (m.url ? new URL(m.url).hostname : "");

/** Operations > Giving > Ways to give: the ministry's own giving accounts, in order, with a live preview of what visitors see. Owners and admins. */
export function WaysToGiveManager({ tenantId, ministryName, initial, standing }: { tenantId: string; ministryName: string; initial: GivingMethod[]; standing: GivingStanding }) {
  const t = useTranslations("WaysToGive");
  const request = useRequest();
  const endpoint = `/api/workspaces/${tenantId}/giving/methods`;
  const [methods, setMethods] = useState(initial);
  const [editing, setEditing] = useState<GivingMethod | "new" | null>(null);
  const [removing, setRemoving] = useState<GivingMethod | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const enabled = useMemo(() => methods.filter((m) => m.enabled), [methods]);
  const liveCount = enabled.length;
  const full = methods.length >= givingLimits.methods;

  async function toggle(method: GivingMethod, value: boolean) {
    setError(""); setBusy(true);
    const result = await request<GivingMethod>(`${endpoint}/${method.id}`, { method: "PATCH", body: { version: method.version, method: { ...toInput(fromMethod(method)), enabled: value } } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setMethods((current) => current.map((m) => m.id === method.id ? result.data : m));
  }
  async function move(index: number, by: number) {
    const next = [...methods], [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setError(""); setBusy(true);
    const result = await request<GivingMethod[]>(`${endpoint}/order`, { method: "PUT", body: { ids: next.map((m) => m.id) } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setMethods(result.data);
  }
  async function remove(method: GivingMethod) {
    const result = await request<{ id: string }>(`${endpoint}/${method.id}`, { method: "DELETE" });
    if (!result.ok) return result.error;
    setMethods((current) => current.filter((m) => m.id !== method.id));
  }

  const add = (
    <Button size="sm" variant="outline" className="max-lg:min-h-11" disabled={full} onClick={() => setEditing("new")}>
      <Plus />
      {t("add")}
    </Button>
  );

  return <div className="space-y-4">
    {standing.hidden && <Alert variant="destructive" data-giving-hidden><ShieldAlert aria-hidden="true" /><AlertTitle>{t("hiddenByStaff")}</AlertTitle>
      <AlertDescription>{standing.reason ? t("hiddenReason", { reason: standing.reason }) : t("hiddenNoReason")}</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
    <Card className="w-full">
      <CardHeader>
        <CardTitle><h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1></CardTitle>
        <CardDescription className="text-xs">
          {methods.length ? t("liveCount", { live: liveCount, total: methods.length }) : t("description")}
          {full && <> {t("limit", { max: givingLimits.methods })}</>}
        </CardDescription>
        <CardAction>
          {add}
        </CardAction>
      </CardHeader>
      <CardContent>
        {methods.length === 0 ? <EmptyState icon={HandCoins} title={t("emptyTitle")} description={t("emptyDescription")} size="compact" headingLevel={2} /> : (
        <ItemGroup className="gap-0 has-data-[size=sm]:gap-0" aria-label={t("title")} data-giving-list>
          {methods.map((method, index) => {
            return (
              <Item
                key={method.id}
                role="listitem"
                size="sm"
                variant="outline"
                className="rounded-none border-x-0 border-t-0 px-0 last:border-b-0"
                data-giving-row={method.id}
              >
                <ItemMedia className="bg-muted size-8 self-start rounded-md border">
                  <GivingMark kind={method.kind} label={t(`kinds.${method.kind}`)} className="size-4" />
                </ItemMedia>
                <ItemContent className="min-w-0 gap-1">
                  <ItemTitle className="flex-wrap break-words">
                    {method.label}
                    {!method.enabled && (
                      <Badge variant="outline">
                        <span className="bg-muted-foreground size-1.5 rounded-full" />
                        {t("hidden")}
                      </Badge>
                    )}
                  </ItemTitle>
                  <ItemDescription className="flex items-center gap-3 text-xs">
                    <span className="break-all">{t(`kinds.${method.kind}`)}</span>
                    <span className="text-foreground break-all tabular-nums">
                      {summary(method)}
                    </span>
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <label className="flex size-11 items-center justify-center lg:size-auto">
                  <Switch
                    checked={method.enabled}
                    disabled={busy}
                    aria-label={t("showLabel", { label: method.label })}
                    onCheckedChange={(checked) => void toggle(method, checked)}
                  />
                  </label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="max-lg:size-11"
                        aria-label={t("actionsFor", { label: method.label })}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="max-lg:min-h-11" onSelect={() => setEditing(method)}><Pencil />{t("editItem")}</DropdownMenuItem>
                      <DropdownMenuItem className="max-lg:min-h-11" disabled={busy || index === 0} onSelect={() => void move(index, -1)}><ArrowUp />{t("moveUpItem")}</DropdownMenuItem>
                      <DropdownMenuItem className="max-lg:min-h-11" disabled={busy || index === methods.length - 1} onSelect={() => void move(index, 1)}><ArrowDown />{t("moveDownItem")}</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" className="max-lg:min-h-11" onSelect={() => setRemoving(method)}>
                        <Trash2 />
                        {t("removeItem")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
        )}
      </CardContent>
    </Card>
    {methods.length > 0 && <FormSection title={t("preview")}>
      {enabled.length && !standing.hidden ? <WaysToGive methods={enabled} ministryName={ministryName} inert headingLevel={3} />
        : <EmptyState size="compact" title={t("previewEmpty")} />}
    </FormSection>}
    </div>
    {editing && <MethodDialog key={editing === "new" ? "new" : editing.id} endpoint={endpoint} method={editing === "new" ? null : editing}
      onClose={() => setEditing(null)} onSaved={(saved) => { setMethods((list) => list.some((m) => m.id === saved.id) ? list.map((m) => m.id === saved.id ? saved : m) : [...list, saved]); setEditing(null); }} />}
    <ConfirmDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }} title={t("removeTitle")} description={removing ? t("removeBody", { label: removing.label }) : undefined}
      cancelLabel={t("cancel")} confirmLabel={t("removeConfirm")} onConfirm={async () => { if (removing) { const problem = await remove(removing); if (problem) return problem; setRemoving(null); } }} />
  </div>;
}
