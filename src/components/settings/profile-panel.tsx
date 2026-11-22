/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/dashboard/(auth)/pages/settings/account/page.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Plus, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { StickySaveBar } from "@/components/sticky-save-bar";
import UserAvatar from "@/components/user-avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useRequest } from "@/hooks/use-request";
import {
  hasLinkIssues, isDirty, linkIssues, maxLinkLabel, maxLinkUrl, maxProfileLinks, moveLink, normalizeDraft, profileVisibilities,
  type ProfileDraft, type ProfileVisibility,
} from "@/lib/profile-links";
import { notify } from "@/lib/toast";

type Profile = { displayName: string | null; bio: string | null; language: string | null; links: { label: string; url: string }[]; visibility: ProfileVisibility; version: number };
const toDraft = (profile: Profile): ProfileDraft => ({ displayName: profile.displayName ?? "", bio: profile.bio ?? "", language: profile.language ?? "", links: profile.links.map((link) => ({ ...link })), visibility: profile.visibility });
const formId = "settings-profile-form";

/**
 * Profile in one community: display name, bio, language, up to three https links and who can see it, on the member-profile routes (they exist
 * only while Communities are on; the section is hidden otherwise). A private profile is whole-profile: there is no per-field privacy.
 * `guard` asks before a change that would drop unsaved edits (the community picker here, the pop-up's own close and section list); `onDirtyChange`
 * tells the pop-up whether there are any.
 */
export function ProfilePanel({ communities, userId, guard, onDirtyChange }: {
  communities: readonly { slug: string; name: string }[]; userId?: string; guard: (proceed: () => void) => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useTranslations("SettingsDialog.profile");
  const [slug, setSlug] = useState(communities[0]?.slug ?? ""), id = useId();
  if (communities.length === 0) return <EmptyState icon={Users} title={t("noCommunities")} size="compact" />;
  const current = communities.find((item) => item.slug === slug) ?? communities[0];
  return <div className="max-w-xl space-y-5">
    {communities.length > 1 && <Field><FieldLabel htmlFor={`${id}-community`}>{t("community")}</FieldLabel>
      <NativeSelect id={`${id}-community`} value={current.slug} onChange={(event) => { const next = event.target.value; guard(() => setSlug(next)); }} className="min-h-11 w-full">
        {communities.map((item) => <NativeSelectOption key={item.slug} value={item.slug}>{item.name}</NativeSelectOption>)}</NativeSelect></Field>}
    {/* Keyed by community: choosing another one starts a fresh load instead of resetting state in an effect. */}
    <CommunityProfileForm key={current.slug} slug={current.slug} communityName={current.name} userId={userId} onDirtyChange={onDirtyChange} />
  </div>;
}

function CommunityProfileForm({ slug, communityName, userId, onDirtyChange }: { slug: string; communityName: string; userId?: string; onDirtyChange: (dirty: boolean) => void }) {
  const t = useTranslations("SettingsDialog.profile"), request = useRequest(), uid = useId();
  const endpoint = `/api/communities/${encodeURIComponent(slug)}/profile`;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading"), [attempt, setAttempt] = useState(0);
  const [saved, setSaved] = useState<ProfileDraft>(() => toDraft({ displayName: null, bio: null, language: null, links: [], visibility: "members", version: 0 }));
  const [draft, setDraft] = useState<ProfileDraft>(saved), [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false), [conflict, setConflict] = useState(false), [tried, setTried] = useState(false);
  const apply = useCallback((profile: Profile) => { const next = toDraft(profile); setSaved(next); setDraft(next); setVersion(profile.version); setConflict(false); setTried(false); }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await request<Profile>(endpoint, { method: "GET" });
      if (cancelled) return;
      if (result.ok) { apply(result.data); setState("ready"); } else setState("error");
    })();
    return () => { cancelled = true; };
  }, [endpoint, attempt, request, apply]);
  const dirty = state === "ready" && isDirty(saved, draft);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const issues = linkIssues(draft.links), shown = tried ? issues : [];
  const patch = (next: Partial<ProfileDraft>) => setDraft((current) => ({ ...current, ...next }));
  const setLink = (index: number, next: Partial<ProfileDraft["links"][number]>) => patch({ links: draft.links.map((link, at) => at === index ? { ...link, ...next } : link) });
  const reload = () => { setState("loading"); setAttempt((value) => value + 1); };

  async function save() {
    if (busy) return;
    setTried(true);
    if (hasLinkIssues(issues)) {
      const at = issues.findIndex((row) => row.label || row.url);
      document.getElementById(`${uid}-link-${at}-${issues[at].label ? "label" : "url"}`)?.focus();
      return;
    }
    setBusy(true);
    const result = await request<Profile>(endpoint, { method: "PUT", body: { version, ...normalizeDraft(draft) } });
    setBusy(false);
    if (result.ok) { apply(result.data); notify.success(t("saved")); return; }
    if (result.status === 409) { setConflict(true); return; }
    notify.error(result.error);
  }
  /** Hide (withdraw) and Clear (erase) act on the stored profile; the form then shows what the server kept. */
  async function change(action: "withdraw" | "erase") {
    const result = action === "withdraw"
      ? await request<Profile>(`${endpoint}/withdraw`, { method: "POST", body: { version } })
      : await request<Profile>(endpoint, { method: "DELETE", body: { version } });
    if (!result.ok) { if (result.status === 409) setConflict(true); return result.error; }
    apply(result.data); notify.success(t(action === "withdraw" ? "hidden" : "cleared"));
  }

  if (state === "loading") return <div className="space-y-4" aria-busy="true" data-testid="profile-loading"><Skeleton className="h-11 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-11 w-full" /></div>;
  if (state === "error") return <Alert variant="destructive" role="alert"><AlertDescription>{t("loadFailed")} <Button type="button" variant="link" onClick={reload}>{t("retry")}</Button></AlertDescription></Alert>;
  const lostEdits = dirty ? ` ${t("editsDiscarded")}` : "";
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center gap-3">
      <UserAvatar name={draft.displayName || communityName} className="size-12" />
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{communityName}</p>
      {userId && <Button asChild variant="outline" size="responsive"><Link href={`/communities/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`} target="_blank" rel="noopener" prefetch={false}>
        {t("viewPage")}<ExternalLink aria-hidden="true" /><span className="sr-only">{t("newTab")}</span></Link></Button>}
    </div>
    {conflict && <Alert variant="destructive" role="alert"><AlertDescription>{t("conflict")} <Button type="button" variant="link" onClick={reload}>{t("loadLatest")}</Button></AlertDescription></Alert>}
    <form id={formId} onSubmit={(event) => { event.preventDefault(); void save(); }} noValidate className="space-y-5">
      <Field><FieldLabel htmlFor={`${uid}-name`}>{t("displayName")}</FieldLabel>
        <Input id={`${uid}-name`} className="min-h-11" value={draft.displayName} onChange={(event) => patch({ displayName: event.target.value })} maxLength={100} disabled={busy} autoComplete="off" /></Field>
      <Field><FieldLabel htmlFor={`${uid}-bio`}>{t("bio")}</FieldLabel>
        <Textarea id={`${uid}-bio`} value={draft.bio} onChange={(event) => patch({ bio: event.target.value })} maxLength={500} rows={4} disabled={busy} /></Field>
      <Field><FieldLabel htmlFor={`${uid}-language`}>{t("language")}</FieldLabel>
        <Input id={`${uid}-language`} className="min-h-11" value={draft.language} onChange={(event) => patch({ language: event.target.value })} maxLength={80} disabled={busy} autoComplete="off" /></Field>

      <fieldset className="space-y-3"><legend className="mb-1 text-sm font-medium">{t("links")}</legend>
        {draft.links.map((link, index) => {
          const row = shown[index] ?? {};
          return <div key={index} className="space-y-3 rounded-lg border p-3" role="group" aria-label={t("linkGroup", { n: index + 1 })}>
            <Field data-invalid={row.label ? true : undefined}><FieldLabel htmlFor={`${uid}-link-${index}-label`}>{t("linkLabelShort")}</FieldLabel>
              <Input id={`${uid}-link-${index}-label`} aria-label={t("linkLabel", { n: index + 1 })} className="min-h-11" value={link.label} onChange={(event) => setLink(index, { label: event.target.value })}
                maxLength={maxLinkLabel} aria-invalid={row.label ? true : undefined} aria-describedby={row.label ? `${uid}-link-${index}-label-error` : undefined} disabled={busy} autoComplete="off" />
              {row.label && <FieldError id={`${uid}-link-${index}-label-error`}>{t(`issues.${row.label}`)}</FieldError>}</Field>
            <Field data-invalid={row.url ? true : undefined}><FieldLabel htmlFor={`${uid}-link-${index}-url`}>{t("linkUrlShort")}</FieldLabel>
              <Input id={`${uid}-link-${index}-url`} aria-label={t("linkUrl", { n: index + 1 })} className="min-h-11" type="url" inputMode="url" placeholder="https://" value={link.url} onChange={(event) => setLink(index, { url: event.target.value })}
                maxLength={maxLinkUrl} aria-invalid={row.url ? true : undefined} aria-describedby={row.url ? `${uid}-link-${index}-url-error` : undefined} disabled={busy} autoComplete="off" />
              {row.url && <FieldError id={`${uid}-link-${index}-url-error`}>{t(`issues.${row.url}`)}</FieldError>}</Field>
            <div className="flex justify-end gap-1">
              <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("moveUp", { n: index + 1 })} disabled={busy || index === 0} onClick={() => patch({ links: moveLink(draft.links, index, -1) })}><ArrowUp aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("moveDown", { n: index + 1 })} disabled={busy || index === draft.links.length - 1} onClick={() => patch({ links: moveLink(draft.links, index, 1) })}><ArrowDown aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("removeLink", { n: index + 1 })} disabled={busy} onClick={() => patch({ links: draft.links.filter((_, at) => at !== index) })}><X aria-hidden="true" /></Button>
            </div>
          </div>;
        })}
        {draft.links.length < maxProfileLinks && <Button type="button" variant="outline" size="responsive" onClick={() => patch({ links: [...draft.links, { label: "", url: "" }] })} disabled={busy}><Plus aria-hidden="true" />{t("addLink")}</Button>}
      </fieldset>

      <fieldset className="space-y-1"><legend className="mb-1 text-sm font-medium">{t("visibility")}</legend>
        <RadioGroup value={draft.visibility} onValueChange={(next) => patch({ visibility: next as ProfileVisibility })} disabled={busy} className="gap-1">
          {profileVisibilities.map((value) => <Label key={value} htmlFor={`${uid}-visibility-${value}`} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2 font-normal hover:bg-muted">
            <RadioGroupItem id={`${uid}-visibility-${value}`} value={value} className="mt-0.5" />
            <span className="min-w-0"><span className="font-medium">{t(`visibilityOptions.${value}.title`)}</span><span className="block text-muted-foreground">{t(`visibilityOptions.${value}.detail`)}</span></span></Label>)}
        </RadioGroup>
      </fieldset>
    </form>

    <div className="flex flex-wrap gap-2 border-t pt-5">
      {saved.visibility !== "private" && <ConfirmDialog tone="neutral" title={t("hideTitle")} description={t("hideBody") + lostEdits} confirmLabel={t("hideConfirm")} cancelLabel={t("cancel")}
        trigger={<Button type="button" variant="outline" size="responsive">{t("hide")}</Button>} onConfirm={() => change("withdraw")} />}
      <ConfirmDialog title={t("clearTitle")} description={t("clearBody") + lostEdits} confirmLabel={t("clearConfirm")} cancelLabel={t("cancel")}
        trigger={<Button type="button" variant="outline" size="responsive" className="text-destructive hover:text-destructive">{t("clear")}</Button>} onConfirm={() => change("erase")} />
    </div>
    <StickySaveBar dirty={dirty} busy={busy} form={formId} saveLabel={t("save")} savingLabel={t("saving")} onDiscard={() => { setDraft(saved); setTried(false); }} />
  </div>;
}
