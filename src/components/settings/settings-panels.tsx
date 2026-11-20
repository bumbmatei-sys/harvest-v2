/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/dashboard/(auth)/pages/settings/account/page.tsx, app/dashboard/(auth)/pages/settings/notifications/page.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Plus, Users, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { AccountProfileForm } from "@/components/account-profile-form";
import { EmptyState } from "@/components/empty-state";
import { MinistrySettingsForm } from "@/components/ministry-settings-form";
import { AccountsBoard } from "@/components/social/accounts-board";
import UserAvatar from "@/components/user-avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useRequest } from "@/hooks/use-request";
import type { Audience } from "@/lib/audience";
import { navEntries } from "@/lib/navigation";
import { notify } from "@/lib/toast";

type Visibility = "members" | "unlisted" | "private";
type ProfileLink = { label: string; url: string };
type Profile = { displayName: string | null; bio: string | null; language: string | null; links: ProfileLink[]; visibility: Visibility; version: number };
const visibilities: readonly Visibility[] = ["members", "unlisted", "private"];
const maxLinks = 3;

/** One row of a settings list that opens a full page. */
function LinkRow({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  return <Link href={href} prefetch={false} className="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-card px-3 text-sm font-medium outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
    <span className="flex items-center gap-3"><Icon className="size-4 text-muted-foreground" aria-hidden="true" />{label}</span><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></Link>;
}
const entryFor = (id: string) => navEntries.find((entry) => entry.id === id);

/**
 * Profile in one community: display name, bio, language, up to three links and who can see it. Uses the member-profile routes, which exist only
 * while Communities are on (the section is hidden otherwise). A private profile is whole-profile: there is no per-field privacy.
 */
export function ProfilePanel({ communities }: { communities: readonly { slug: string; name: string }[] }) {
  const t = useTranslations("SettingsDialog.profile");
  const [slug, setSlug] = useState(communities[0]?.slug ?? "");
  if (communities.length === 0) return <EmptyState icon={Users} title={t("noCommunities")} size="compact" />;
  const current = communities.find((item) => item.slug === slug) ?? communities[0];
  return <div className="max-w-xl space-y-5">
    {communities.length > 1 && <Field><FieldLabel htmlFor="settings-profile-community">{t("community")}</FieldLabel>
      <NativeSelect id="settings-profile-community" value={current.slug} onChange={(event) => setSlug(event.target.value)} className="min-h-11 w-full">
        {communities.map((item) => <NativeSelectOption key={item.slug} value={item.slug}>{item.name}</NativeSelectOption>)}</NativeSelect></Field>}
    {/* Keyed by community: choosing another one starts a fresh load instead of resetting state in an effect. */}
    <CommunityProfileForm key={current.slug} slug={current.slug} communityName={current.name} />
  </div>;
}

function CommunityProfileForm({ slug, communityName }: { slug: string; communityName: string }) {
  const t = useTranslations("SettingsDialog.profile"), request = useRequest();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading"), [attempt, setAttempt] = useState(0);
  const [name, setName] = useState(""), [bio, setBio] = useState(""), [language, setLanguage] = useState(""), [links, setLinks] = useState<ProfileLink[]>([]), [visibility, setVisibility] = useState<Visibility>("members"), [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const apply = useCallback((profile: Profile) => {
    setName(profile.displayName ?? ""); setBio(profile.bio ?? ""); setLanguage(profile.language ?? ""); setLinks(profile.links); setVisibility(profile.visibility); setVersion(profile.version);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await request<Profile>(`/api/communities/${encodeURIComponent(slug)}/profile`, { method: "GET" });
      if (cancelled) return;
      if (result.ok) { apply(result.data); setState("ready"); } else setState("error");
    })();
    return () => { cancelled = true; };
  }, [slug, attempt, request, apply]);
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const cleaned = links.map((item) => ({ label: item.label.trim(), url: item.url.trim() })).filter((item) => item.label || item.url);
    if (cleaned.some((item) => !item.label || !item.url.startsWith("https://"))) { setError(t("linkInvalid")); return; }
    setBusy(true);
    const result = await request<Profile>(`/api/communities/${encodeURIComponent(slug)}/profile`, { method: "PUT", body: { version, displayName: name.trim() || null, bio: bio.trim() || null, language: language.trim() || null, links: cleaned, visibility } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    apply(result.data); notify.success(t("saved"));
  }
  const setLink = (index: number, patch: Partial<ProfileLink>) => setLinks((current) => current.map((item, at) => at === index ? { ...item, ...patch } : item));
  if (state === "loading") return <div className="space-y-4" aria-busy="true" data-testid="profile-loading"><Skeleton className="h-11 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-11 w-full" /></div>;
  if (state === "error") return <Alert variant="destructive" role="alert"><AlertDescription>{t("loadFailed")} <Button type="button" variant="link" onClick={() => { setState("loading"); setAttempt((value) => value + 1); }}>{t("retry")}</Button></AlertDescription></Alert>;
  return <form onSubmit={save} className="space-y-5">
    <div className="flex items-center gap-3"><UserAvatar name={name || communityName} className="size-12" /><p className="min-w-0 truncate text-sm font-medium">{communityName}</p></div>
    <Field><FieldLabel htmlFor="settings-profile-name">{t("displayName")}</FieldLabel><Input id="settings-profile-name" className="min-h-11" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} disabled={busy} /></Field>
    <Field><FieldLabel htmlFor="settings-profile-bio">{t("bio")}</FieldLabel><Textarea id="settings-profile-bio" value={bio} onChange={(event) => setBio(event.target.value)} maxLength={500} rows={4} disabled={busy} /></Field>
    <Field><FieldLabel htmlFor="settings-profile-language">{t("language")}</FieldLabel><Input id="settings-profile-language" className="min-h-11" value={language} onChange={(event) => setLanguage(event.target.value)} maxLength={80} disabled={busy} /></Field>
    <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">{t("links")}</legend>
      {links.map((item, index) => <div key={index} className="flex items-center gap-2">
        <Input aria-label={t("linkLabel", { n: index + 1 })} className="min-h-11 w-1/3" value={item.label} onChange={(event) => setLink(index, { label: event.target.value })} maxLength={40} disabled={busy} />
        <Input aria-label={t("linkUrl", { n: index + 1 })} className="min-h-11 flex-1" type="url" inputMode="url" value={item.url} onChange={(event) => setLink(index, { url: event.target.value })} maxLength={2048} disabled={busy} />
        <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("removeLink", { n: index + 1 })} onClick={() => setLinks((current) => current.filter((_, at) => at !== index))} disabled={busy}><X aria-hidden="true" /></Button>
      </div>)}
      {links.length < maxLinks && <Button type="button" variant="outline" size="responsive" onClick={() => setLinks((current) => [...current, { label: "", url: "" }])} disabled={busy}><Plus aria-hidden="true" />{t("addLink")}</Button>}
    </fieldset>
    <fieldset className="space-y-1"><legend className="mb-1 text-sm font-medium">{t("visibility")}</legend>
      <RadioGroup value={visibility} onValueChange={(next) => setVisibility(next as Visibility)} disabled={busy} className="gap-1">
        {visibilities.map((value) => <Label key={value} htmlFor={`settings-profile-visibility-${value}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 font-normal hover:bg-muted md:min-h-9">
          <RadioGroupItem id={`settings-profile-visibility-${value}`} value={value} />{t(`visibilityOptions.${value}`)}</Label>)}
      </RadioGroup>
    </fieldset>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <Button className="min-h-11" disabled={busy}>{t(busy ? "saving" : "save")}</Button>
  </form>;
}

/** The account: name, language and city on the existing account profile route, with the email the person signs in with. */
export function AccountPanel() {
  const t = useTranslations("SettingsDialog.account");
  const [profile, setProfile] = useState<{ email: string; name: string; locale: string | null; cityRegion: string | null } | "error" | null>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/account/profile", { cache: "no-store", signal: controller.signal });
        const body = response.ok ? await response.json() : "error";
        if (!controller.signal.aborted) setProfile(body);
      } catch { if (!controller.signal.aborted) setProfile("error"); }
    })();
    return () => controller.abort();
  }, [attempt]);
  if (profile === null) return <div className="max-w-xl space-y-4" aria-busy="true" data-testid="account-loading"><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /></div>;
  if (profile === "error") return <Alert variant="destructive" role="alert" className="max-w-xl"><AlertDescription>{t("loadFailed")} <Button type="button" variant="link" onClick={() => { setProfile(null); setAttempt((value) => value + 1); }}>{t("retry")}</Button></AlertDescription></Alert>;
  return <div className="max-w-xl space-y-5">
    <div className="flex items-center gap-3"><UserAvatar name={profile.name} className="size-12" /><div className="min-w-0"><p className="truncate text-sm font-medium">{profile.name}</p><p className="truncate text-xs text-muted-foreground">{profile.email}</p></div></div>
    <AccountProfileForm initial={{ name: profile.name, locale: profile.locale, cityRegion: profile.cityRegion }} mode="profile" />
  </div>;
}

/** Ministry details: the ministry type (owners and admins) and a link to the appearance page. */
export function MinistryPanel({ tenantId, name, role, audience }: { tenantId: string; name: string; role: string; audience: Audience | null }) {
  const t = useTranslations("SettingsDialog.ministry"), shell = useTranslations("ComponentsAppShell");
  const appearance = entryFor("appearance");
  return <div className="max-w-xl space-y-6">
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm"><dt className="text-muted-foreground">{t("name")}</dt><dd className="min-w-0 truncate font-medium">{name}</dd>
      <dt className="text-muted-foreground">{t("role")}</dt><dd className="font-medium">{shell(`roles.${role as "owner"}`)}</dd></dl>
    <MinistrySettingsForm tenantId={tenantId} current={audience} writable inline />
    {appearance && <LinkRow href={`/workspaces/${tenantId}${appearance.path}`} label={shell(appearance.label)} icon={appearance.icon} />}
  </div>;
}

/** Connections: the social accounts board of `/social/accounts`, embedded. That page stays reachable at its own address. */
export function ConnectionsPanel({ tenantId, testCredential }: { tenantId: string; testCredential?: string }) {
  return <AccountsBoard tenantId={tenantId} testConnect={testCredential !== undefined} testCredential={testCredential ?? ""} embedded />;
}

/** CRM: the field and pipeline setup pages. */
export function CrmPanel({ tenantId }: { tenantId: string }) {
  const shell = useTranslations("ComponentsAppShell");
  return <div className="max-w-xl space-y-2">
    {["crmFields", "pipelineSettings"].map((id) => { const entry = entryFor(id); return entry ? <LinkRow key={id} href={`/workspaces/${tenantId}${entry.path}`} label={shell(entry.label)} icon={entry.icon} /> : null; })}
  </div>;
}
