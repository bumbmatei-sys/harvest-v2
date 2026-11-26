"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { bioLimits } from "@/lib/link-in-bio";

type State = "idle" | "sending" | "sent" | "invalid" | "limited" | "unavailable" | "expired";

/**
 * "Message me": name, email, message and the fixed consent line (never pre-ticked). The proof comes from the server when the form mounts (and again if it expires);
 * a hidden field catches bots. Nothing is stored in the browser, and no email is sent to anyone. In the editor's preview the same form is shown inert.
 */
const MINIMUM_FILL_MS = 1_100; // the server minimum is one second
export function BioMessageForm({ handle, title, notice, inert = false }: { handle: string; title: string; notice: string; inert?: boolean }) {
  const t = useTranslations("LinkInBio.public"), id = useId();
  const [proof, setProof] = useState<string | null>(null), [state, setState] = useState<State>("idle");
  // When the current proof reached this browser: the server refuses a message sent less than a second after its proof was issued (bots), so a proof loaded just now is waited out.
  const proofAt = useRef(0);
  const [fields, setFields] = useState({ name: "", email: "", message: "", website: "" }), [agreed, setAgreed] = useState(false);
  const loadProof = useCallback(async () => {
    try {
      const response = await fetch(`/l/${encodeURIComponent(handle)}/message`, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) { setProof(null); setState(response.status === 404 ? "unavailable" : "limited"); return null; }
      const data = await response.json() as { proof?: string };
      setProof(data.proof ?? null); proofAt.current = Date.now();
      return data.proof ?? null;
    } catch { setState("unavailable"); return null; }
  }, [handle]);
  useEffect(() => { if (inert) return; void (async () => { await Promise.resolve(); await loadProof(); })(); }, [inert, loadProof]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inert || state === "sending") return;
    if (!agreed || !fields.name.trim() || !fields.message.trim() || !/^\S+@\S+\.\S+$/.test(fields.email.trim())) { setState("invalid"); return; }
    setState("sending");
    const current = proof ?? await loadProof();
    if (!current) { setState((previous) => previous === "sending" ? "unavailable" : previous); return; }
    // A proof fetched a moment ago (the first load was slow or failed) is too fresh for the server's minimum fill time: wait it out instead of failing the first send.
    const wait = MINIMUM_FILL_MS - (Date.now() - proofAt.current);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      const response = await fetch(`/l/${encodeURIComponent(handle)}/message`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof: current, name: fields.name, email: fields.email, message: fields.message, consent: true, ...(fields.website ? { website: fields.website } : {}) }) });
      if (response.ok) { setState("sent"); setFields({ name: "", email: "", message: "", website: "" }); setAgreed(false); setProof(null); return; }
      if (response.status === 429) setState("limited");
      else if (response.status === 404) setState("unavailable");
      else { setState("invalid"); await loadProof(); }
    } catch { setState("unavailable"); }
  }
  const set = (key: keyof typeof fields) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setState("idle"); setFields((previous) => ({ ...previous, [key]: event.target.value })); };

  if (state === "sent") return <div role="status" className="space-y-3 rounded-xl border bg-card p-4 text-card-foreground" data-bio-message-sent>
    <p className="text-sm font-medium">{t("messageSent")}</p>
    <Button type="button" variant="outline" className="min-h-11" onClick={() => setState("idle")}>{t("messageAnother")}</Button>
  </div>;
  const problem = state === "invalid" ? t("messageInvalid") : state === "limited" ? t("messageLimited") : state === "unavailable" ? t("messageUnavailable") : state === "expired" ? t("messageReload") : null;
  return <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border bg-card p-4 text-card-foreground" data-bio-message-form aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className="text-base font-semibold">{title}</h2>
    {problem && <Alert variant={state === "invalid" ? "destructive" : "default"} role="alert"><AlertDescription>{problem}</AlertDescription></Alert>}
    <Field><FieldLabel htmlFor={`${id}-name`}>{t("messageName")}</FieldLabel>
      <Input id={`${id}-name`} className="min-h-11" autoComplete="name" maxLength={bioLimits.senderName} value={fields.name} onChange={set("name")} disabled={inert} /></Field>
    <Field><FieldLabel htmlFor={`${id}-email`}>{t("messageEmail")}</FieldLabel>
      <Input id={`${id}-email`} type="email" className="min-h-11" autoComplete="email" maxLength={bioLimits.senderEmail} value={fields.email} onChange={set("email")} disabled={inert} /></Field>
    <Field><FieldLabel htmlFor={`${id}-message`}>{t("messageBody")}</FieldLabel>
      <Textarea id={`${id}-message`} rows={4} maxLength={bioLimits.messageBody} value={fields.message} onChange={set("message")} disabled={inert} /></Field>
    {/* Honeypot: invisible to people and to assistive technology, tempting to bots. */}
    <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><input name="website" tabIndex={-1} autoComplete="off" value={fields.website} onChange={set("website")} /></div>
    <Field orientation="horizontal" className="items-start gap-3">
      <Checkbox id={`${id}-consent`} checked={agreed} disabled={inert} onCheckedChange={(value) => { setState("idle"); setAgreed(value === true); }} className="mt-0.5 size-5" />
      <FieldLabel htmlFor={`${id}-consent`} className="min-h-11 flex-1 text-sm font-normal leading-snug">{notice}</FieldLabel>
    </Field>
    <Button type="submit" className="min-h-11 w-full" disabled={inert || state === "sending"}>{state === "sending" ? t("messageSending") : t("messageSend")}</Button>
  </form>;
}
