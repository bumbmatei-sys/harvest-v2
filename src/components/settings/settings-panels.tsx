/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/dashboard/(auth)/pages/settings/account/page.tsx, app/dashboard/(auth)/pages/settings/notifications/page.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { AccountProfileForm } from "@/components/account-profile-form";
import { MinistrySettingsForm } from "@/components/ministry-settings-form";
import { AccountsBoard } from "@/components/social/accounts-board";
import UserAvatar from "@/components/user-avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Audience } from "@/lib/audience";
import { navEntries } from "@/lib/navigation";

/** One row of a settings list that opens a full page. */
function LinkRow({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  return <Link href={href} prefetch={false} className="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-card px-3 text-sm font-medium outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
    <span className="flex items-center gap-3"><Icon className="size-4 text-muted-foreground" aria-hidden="true" />{label}</span><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></Link>;
}
const entryFor = (id: string) => navEntries.find((entry) => entry.id === id);

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
export function MinistryPanel({ tenantId, name, role, audience, timeZone }: { tenantId: string; name: string; role: string; audience: Audience | null; timeZone?: string }) {
  const t = useTranslations("SettingsDialog.ministry"), shell = useTranslations("ComponentsAppShell");
  const appearance = entryFor("appearance");
  return <div className="max-w-xl space-y-6">
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm"><dt className="text-muted-foreground">{t("name")}</dt><dd className="min-w-0 truncate font-medium">{name}</dd>
      <dt className="text-muted-foreground">{t("role")}</dt><dd className="font-medium">{shell(`roles.${role as "owner"}`)}</dd></dl>
    <MinistrySettingsForm tenantId={tenantId} current={audience} timeZone={timeZone} writable inline />
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
