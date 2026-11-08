"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { LandingContent } from "@/components/connect/landing-view";
import { ResponseForm } from "@/components/connect/response-form";
import { useCrmRequest } from "@/components/crm/request";
import { campaignLanding, starterResources } from "@/lib/connect-public";
import { sameLandingDefinition, landingDefinition, type LandingCard, type LandingDefinition } from "@/lib/connect-landing";
import type { IntakeManifest } from "@/lib/connect-intake";
import type { EditableLanding } from "@/server/connect-landing";

export function LandingEditor({ initial, endpoint, backHref, manifest }: { initial: EditableLanding; endpoint: string; backHref: string; manifest: IntakeManifest | null }) {
  const t = useTranslations("LandingEditor"), links = useTranslations("ConnectLinks"), resources = useTranslations("Connect"), id = useId(), request = useCrmRequest();
  const [data, setData] = useState(initial), [heading, setHeading] = useState(initial.definition.heading), [welcome, setWelcome] = useState(initial.definition.message);
  const [cards, setCards] = useState(() => initial.definition.cards.map((card, index) => ({ id: `${id}-${index}`, card })));
  const [busy, setBusy] = useState<"save" | "publish" | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false), [destination, setDestination] = useState<string | null>(null);
  const definition: LandingDefinition = { heading, message: welcome, cards: cards.map(({ card }) => card) };
  const dirty = !sameLandingDefinition(definition, data.definition), dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty || busy !== null; }, [dirty, busy]);
  useEffect(() => {
    function unload(event: BeforeUnloadEvent) { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } }
    function click(event: MouseEvent) {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!dirtyRef.current || !anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const url = new URL(anchor.href, location.href);
      if (url.href === location.href || (url.pathname === location.pathname && url.search === location.search && url.hash)) return;
      event.preventDefault(); event.stopPropagation(); setDestination(url.href);
    }
    // Navigation API covers browser Back/Forward before leaving. beforeunload protects reloads
    // and browsers without this API; same-origin links are guarded in capture phase as well.
    const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
    function navigate(event: Event) {
      const e = event as Event & { navigationType?: string; destination?: { url: string }; canIntercept?: boolean };
      if (dirtyRef.current && e.navigationType === "traverse" && e.cancelable && e.destination) { e.preventDefault(); setDestination(e.destination.url); }
    }
    window.addEventListener("beforeunload", unload); document.addEventListener("click", click, true); navigation?.addEventListener("navigate", navigate);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); navigation?.removeEventListener("navigate", navigate); };
  }, []);
  async function persist(publish: boolean) {
    setError(""); setNotice("");
    if (!publish && !landingDefinition.safeParse(definition).success) { setError(t("invalid")); return; }
    setBusy(publish ? "publish" : "save");
    const result = await request<EditableLanding>(publish ? `${endpoint}/publish` : endpoint, { method: publish ? "POST" : "PUT", body: {
      expectedRevision: data.revision, expectedCode: data.expectedCode, ...(!publish ? { definition } : {}),
    } });
    setBusy(null);
    if (!result.ok) { setConflict(result.status === 409); setError(result.status === 409 ? t("conflict") : result.status === 400 ? t("invalid") : result.error); return; }
    setData(result.data); setNotice(t(publish ? "published" : "saved"));
  }
  function update(index: number, card: LandingCard) { setNotice(""); setCards(previous => previous.map((item, i) => i === index ? { ...item, card } : item)); }
  function add(card: LandingCard) { setCards(previous => [...previous, { id: crypto.randomUUID(), card }]); setNotice(t("added", { number: cards.length + 1 })); }
  function move(index: number, direction: number) {
    const next = [...cards], cardId = next[index].id, target = index + direction;
    [next[index], next[target]] = [next[target], next[index]]; setCards(next); setNotice(t("moved", { number: target + 1 }));
    const control = direction < 0 ? (target === 0 ? "down" : "up") : (target === next.length - 1 ? "up" : "down");
    requestAnimationFrame(() => document.getElementById(`${cardId}-${control}`)?.focus());
  }
  return <div className="min-w-0 space-y-6">
    <Button variant="link" asChild className="min-h-11 px-0 text-muted-foreground"><Link href={backHref}><ArrowLeft aria-hidden="true" />{links("title")}</Link></Button>
    <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1><p className="max-w-3xl text-muted-foreground">{t("description")}</p>
      <p className="text-sm text-muted-foreground">{t("draftStatus", { revision: data.revision, published: data.published?.revision ?? t("none") })}</p>
      {dirty && <Badge variant="secondary">{t("unsaved")}</Badge>}
    </div>
    {!data.permissions.edit && <Alert><AlertDescription>{t("readOnly")}</AlertDescription></Alert>}
    {!data.permissions.publish && data.permissions.edit && <p className="text-sm text-muted-foreground">{t("ownerOnly")}</p>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}{conflict && <Button variant="outline" className="mt-3 min-h-11 self-start" onClick={() => { if (dirty) setDestination(location.href); else location.reload(); }}>{t("reload")}</Button>}</AlertDescription></Alert>}
    <p role="status" aria-live="polite" className="text-sm">{notice}</p>
    <div className="grid min-w-0 gap-8 xl:grid-cols-2">
      <form className="min-w-0" onSubmit={event => { event.preventDefault(); if (!busy && !conflict) void persist(false); }}>
        <fieldset disabled={Boolean(busy) || !data.permissions.edit || conflict} className="min-w-0 space-y-6">
          <FieldGroup>
            <Field><FieldLabel htmlFor={`${id}-heading`}>{t("heading")}</FieldLabel><Input id={`${id}-heading`} value={heading} onChange={e => setHeading(e.target.value)} maxLength={120} className="min-h-11" aria-describedby={`${id}-heading-help`} /><FieldDescription id={`${id}-heading-help`}>{t("headingHelp")}</FieldDescription></Field>
            <Field><FieldLabel htmlFor={`${id}-message`}>{t("message")}</FieldLabel><Textarea id={`${id}-message`} value={welcome} onChange={e => setWelcome(e.target.value)} maxLength={600} rows={5} aria-describedby={`${id}-message-help`} /><FieldDescription id={`${id}-message-help`}>{t("messageHelp")}</FieldDescription></Field>
          </FieldGroup>
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{t("cards")}</h2><p className="text-sm text-muted-foreground">{t("cardCount", { count: cards.length })}</p></div>
          <ol className="space-y-4">{cards.map(({ id: cardId, card }, index) => <li key={cardId}><Card className="min-w-0">
            <CardHeader><CardTitle><h3>{t("cardLegend", { number: index + 1 })}</h3></CardTitle></CardHeader>
            <CardContent className="min-w-0 space-y-4">
              {card.kind === "resource" ? <Field><FieldLabel htmlFor={`${cardId}-resource`}>{t("resourceLabel")}</FieldLabel><NativeSelect id={`${cardId}-resource`} value={card.resourceId} onChange={e => update(index, { kind: "resource", resourceId: e.target.value as typeof card.resourceId })} className="min-h-11 max-w-full">
                {starterResources.map(({ id }) => <NativeSelectOption key={id} value={id}>{resources(`resources.${id}.title`)}</NativeSelectOption>)}
              </NativeSelect></Field> : <FieldGroup>
                <Field><FieldLabel htmlFor={`${cardId}-category`}>{t("category")}</FieldLabel><NativeSelect id={`${cardId}-category`} value={card.category} onChange={e => update(index, { ...card, category: e.target.value as typeof card.category, price: e.target.value === "community" ? "free" : card.price })} className="min-h-11">
                  {(["community", "course", "product"] as const).map(type => <NativeSelectOption key={type} value={type}>{t(type)}</NativeSelectOption>)}
                </NativeSelect></Field>
                <Field><FieldLabel htmlFor={`${cardId}-title`}>{t("cardTitle")}</FieldLabel><Input id={`${cardId}-title`} value={card.title} onChange={e => update(index, { ...card, title: e.target.value })} required maxLength={120} className="min-h-11" /></Field>
                <Field><FieldLabel htmlFor={`${cardId}-description`}>{t("cardDescription")}</FieldLabel><Textarea id={`${cardId}-description`} value={card.description} onChange={e => update(index, { ...card, description: e.target.value })} maxLength={300} /></Field>
                <Field><FieldLabel htmlFor={`${cardId}-url`}>{t("url")}</FieldLabel><Input id={`${cardId}-url`} type="url" value={card.url} onChange={e => update(index, { ...card, url: e.target.value })} required maxLength={2048} className="min-h-11" aria-describedby={`${cardId}-url-help`} /><FieldDescription id={`${cardId}-url-help`}>{t("urlHelp")}</FieldDescription></Field>
                <Field><FieldLabel htmlFor={`${cardId}-price`}>{t("price")}</FieldLabel><NativeSelect id={`${cardId}-price`} value={card.price} disabled={card.category === "community"} onChange={e => update(index, { ...card, price: e.target.value as typeof card.price })} className="min-h-11"><NativeSelectOption value="free">{t("free")}</NativeSelectOption><NativeSelectOption value="paid">{t("paid")}</NativeSelectOption></NativeSelect></Field>
              </FieldGroup>}
              <div className="flex flex-wrap gap-2">
                <Button id={`${cardId}-up`} type="button" variant="outline" className="min-h-11 min-w-11" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("up", { number: index + 1 })}><ArrowUp aria-hidden="true" /></Button>
                <Button id={`${cardId}-down`} type="button" variant="outline" className="min-h-11 min-w-11" disabled={index === cards.length - 1} onClick={() => move(index, 1)} aria-label={t("down", { number: index + 1 })}><ArrowDown aria-hidden="true" /></Button>
                <Button id={`${cardId}-remove`} type="button" variant="outline" className="min-h-11 min-w-11" onClick={() => { const target = cards[index + 1]?.id ?? cards[index - 1]?.id; setCards(previous => previous.filter(item => item.id !== cardId)); setNotice(t("removed")); requestAnimationFrame(() => document.getElementById(target ? `${target}-remove` : `${id}-add-resource`)?.focus()); }} aria-label={t("remove", { number: index + 1 })}><Trash2 aria-hidden="true" /></Button>
              </div>
            </CardContent>
          </Card></li>)}</ol>
          <div className="flex flex-wrap gap-2"><Button id={`${id}-add-resource`} type="button" variant="outline" disabled={cards.length >= 8} className="min-h-11 whitespace-normal" onClick={() => add({ kind: "resource", resourceId: "first-reading" })}><Plus aria-hidden="true" />{t("addResource")}</Button>
            <Button type="button" variant="outline" disabled={cards.length >= 8} className="min-h-11 whitespace-normal" onClick={() => add({ kind: "external", category: "community", price: "free", title: "", description: "", url: "" })}><Plus aria-hidden="true" />{t("addExternal")}</Button></div>
          <p className="text-sm text-muted-foreground">{t("publicationHelp")}</p>
          <div className="flex flex-wrap gap-3"><Button type="submit" disabled={!dirty} className="min-h-11">{t(busy === "save" ? "saving" : "save")}</Button>
            {data.permissions.publish && <Button type="button" variant="outline" className="min-h-11" disabled={dirty || data.revision === 0 || data.published?.revision === data.revision} onClick={() => void persist(true)}>{t(busy === "publish" ? "publishing" : "publish")}</Button>}
          </div>{dirty && <p className="text-sm text-muted-foreground">{t("saveFirst")}</p>}
        </fieldset>
      </form>
      <section className="min-w-0 space-y-4" aria-label={t("preview")}>
        <div className="space-y-2"><h2 className="text-lg font-semibold">{t("preview")}</h2><p className="text-sm text-muted-foreground">{t("previewHelp")}</p></div>
        <div className="min-w-0 rounded-xl border bg-background p-4 sm:p-6">
          <LandingContent landing={campaignLanding("en", data.title, definition)} responseHref={manifest ? "#response-form" : undefined} invitationAvailable={Boolean(manifest?.purposes.includes("account_communications"))} preview />
          {manifest && <ResponseForm manifest={manifest} endpoint="" preview />}
        </div>
      </section>
    </div>
    <AlertDialog open={destination !== null} onOpenChange={open => { if (!open) setDestination(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("leaveTitle")}</AlertDialogTitle><AlertDialogDescription>{t("leaveBody")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="min-h-11">{t("stay")}</AlertDialogCancel><AlertDialogAction className="min-h-11" onClick={() => { dirtyRef.current = false; if (destination) location.assign(destination); }}>{t("leave")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
