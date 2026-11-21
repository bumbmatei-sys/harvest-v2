"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Building2, Kanban, Loader2, Search, UsersRound, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useCrmRequest } from "@/components/crm/request";
import { templateIcon } from "@/components/crm/forms/template-icons";
import type { Destination } from "@/components/crm/forms/form-settings";
import { isTemplateId, templateIds, type TemplateId } from "@/lib/crm-forms";

/** Template picker, then "Where should submissions be saved?". Picking a destination creates the draft and opens the editor. */
export function FormNew({ tenantId, destinations, template: initial }: { tenantId: string; destinations: Destination[]; template: string | null }) {
  const t = useTranslations("CrmForms.new"), tt = useTranslations("CrmForms.templates"), router = useRouter(), request = useCrmRequest();
  const [template, setTemplate] = useState<TemplateId | "scratch" | null>(initial === "scratch" ? "scratch" : isTemplateId(initial) ? initial : null);
  const [query, setQuery] = useState(""), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  const shown = useMemo(() => destinations.filter((d) => d.label.toLowerCase().includes(query.trim().toLowerCase())), [destinations, query]);
  const back = `/workspaces/${tenantId}/crm/forms`;
  // The chosen template lives in the address too, so a reload or a shared link lands on the same step.
  const choose = (next: TemplateId | "scratch" | null) => { setTemplate(next); window.history.replaceState(null, "", next ? `${back}/new?template=${next}` : `${back}/new`); };

  async function create(destination: Destination) {
    if (!template) return;
    setBusy(destination.value); setError("");
    const body = { template: template === "scratch" ? null : template, destination: destination.value.startsWith("pipeline:") ? { type: "pipeline", pipelineId: destination.value.slice(9) } : { type: destination.value } };
    const result = await request<{ id: string }>(`/api/workspaces/${tenantId}/crm/forms`, { method: "POST", body });
    if (!result.ok) { setError(result.error); setBusy(null); return; }
    router.push(`${back}/${result.data.id}`);
  }
  const icon = (value: string) => value === "people" ? UsersRound : value === "organizations" ? Building2 : Kanban;

  return <div className="relative mx-auto w-full max-w-5xl space-y-8 py-6" data-form-new>
    <Button asChild variant="ghost" size="icon" className="absolute end-0 top-0 size-11"><Link href={back} aria-label={t("close")}><X aria-hidden="true" /></Link></Button>
    {template === null ? <section className="space-y-6" aria-labelledby="new-template-title">
      <h1 id="new-template-title" className="text-center text-2xl font-semibold tracking-tight">{t("chooseTemplate")}</h1>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...templateIds, "scratch" as const].map((id) => { const Icon = templateIcon[id]; return <li key={id}>
          <Card className="h-full p-0 transition-colors hover:bg-accent/40 focus-within:ring-[3px] focus-within:ring-ring/50">
            <button type="button" onClick={() => choose(id)} data-template={id} className="flex min-h-32 w-full flex-col items-start gap-3 rounded-xl p-5 text-left outline-none">
              <span className="flex size-11 items-center justify-center rounded-full bg-muted"><Icon className="size-5" aria-hidden="true" /></span>
              <span className="space-y-1"><span className="block font-semibold">{id === "scratch" ? t("scratch") : tt(`${id}.name`)}</span>{id !== "scratch" && <span className="block text-sm text-muted-foreground">{tt(`${id}.description`)}</span>}</span></button></Card></li>; })}
      </ul></section>
    : <section className="mx-auto w-full max-w-md space-y-6" aria-labelledby="new-destination-title">
      <Button type="button" variant="ghost" className="min-h-11" onClick={() => choose(null)}><ArrowLeft aria-hidden="true" />{t("back")}</Button>
      <h1 id="new-destination-title" className="text-center text-2xl font-semibold tracking-tight">{t("whereTitle")}</h1>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="rounded-xl border bg-card p-2 shadow-sm">
        <div className="flex items-center gap-2 rounded-md border px-3 focus-within:ring-[3px] focus-within:ring-ring/50"><Search className="size-4 text-muted-foreground" aria-hidden="true" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" /></div>
        <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">{t("browse")}</p>
        <ul aria-label={t("browse")} className="space-y-0.5">{shown.map((d) => { const Icon = icon(d.value.split(":")[0]); return <li key={d.value}>
          <button type="button" data-destination={d.value} disabled={busy !== null} onClick={() => void create(d)} className={cn("flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60")}>
            {busy === d.value ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Icon className="size-4 text-muted-foreground" aria-hidden="true" />}<span className="min-w-0 flex-1 truncate">{d.label}</span></button></li>; })}
          {shown.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">{t("noResults")}</li>}</ul></div>
    </section>}
  </div>;
}
