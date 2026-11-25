/** Derived from Shadcn UI Kit item switch-card1 (premium), registry retrieved 2026-11-25, approved 2026-11-25 (Discover screens). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { request } from "@/hooks/use-request";
import { discoverCategories, type DiscoverType } from "@/lib/discover-taxonomy";
import { discoverLanguages, languageName, reviewTone, type DiscoverCategory, type OwnListing } from "@/lib/discover-ui";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";

type Patch = { optIn?: boolean; category?: DiscoverCategory | null; language?: string | null; requestReview?: true };
type Phase = "idle" | "saving" | "saved" | "conflict" | "failed";

/** Loads and updates one item's Discover state through the ministry's listing routes. The version the person saw goes with every change; a stale one comes back as `conflict`. */
export function useOwnListing(tenantId: string, type: DiscoverType, id: string, initial?: OwnListing) {
  const [listing, setListing] = useState<OwnListing | null>(initial ?? null), [saveState, setSaveState] = useState<Phase>("idle"), [loadFailed, setLoadFailed] = useState(false);
  const base = `/api/workspaces/${tenantId}/discover/listings`;
  const load = useCallback(async () => {
    setLoadFailed(false);
    const result = await request<{ items: OwnListing[] }>(base, { method: "GET" });
    const found = result.ok ? result.data.items.find((item) => item.type === type && item.id === id) : undefined;
    if (found) { setListing(found); setSaveState("idle"); } else setLoadFailed(true);
  }, [base, type, id]);
  useEffect(() => { if (!initial) { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); } }, [initial, load]);
  const save = useCallback(async (patch: Patch) => {
    if (!listing) return null;
    setSaveState("saving");
    const result = await request<{ listing: OwnListing }>(`${base}/${type}/${id}`, { method: "PATCH", body: { version: listing.version, ...patch } });
    if (result.ok) { setListing(result.data.listing); setSaveState("saved"); return result.data.listing; }
    setSaveState(result.status === 409 ? "conflict" : "failed");
    return null;
  }, [base, id, listing, type]);
  return { listing, saveState, loadFailed, save, reload: load };
}

/**
 * The "List in Discover" card: a switch, the review status, the category and the language. A community's switch is its own setting (saved with the community), so the parent passes it in
 * (`community`); a course or product switch is the listing's opt-in and saves here. Changing a public field sends an approved listing back to review, which the card says.
 */
export function ListInDiscover({ tenantId, type, id, canEdit, initial, community, managedAt, onChanged }: {
  tenantId: string; type: DiscoverType; id: string; canEdit: boolean; initial?: OwnListing;
  /** Community only: the draft opt-in, whether the community is Listed and published (the switch is off otherwise), and where the setting lives. */
  community?: { optIn: boolean; eligible: boolean; onOptInChange: (value: boolean) => void };
  /** A community listed from My listings: its switch is read-only here and this link opens the setting that owns it. */
  managedAt?: string;
  onChanged?: (listing: OwnListing) => void;
}) {
  const t = useTranslations("DiscoverScreens"), switchId = useId(), live = useRef<HTMLParagraphElement>(null);
  const { listing, saveState, loadFailed, save, reload } = useOwnListing(tenantId, type, id, initial);
  const optIn = community ? community.optIn : listing?.optIn ?? false;
  const eligible = community ? community.eligible : listing?.published ?? false;
  const state = listing?.review.state ?? "not_requested", reason = listing?.review.reason ?? "";
  const apply = async (patch: Patch) => { const next = await save(patch); if (next) onChanged?.(next); };
  const statusText = state === "pending" ? t("card.pending") : state === "approved" ? t("card.approved") : state === "rejected" ? t("card.rejected", { reason }) : state === "suspended" ? t("card.suspended", { reason }) : "";

  return <div data-slot="list-in-discover" className="space-y-4 rounded-lg border p-4">
    <div className="flex flex-row items-center justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={switchId} className="text-base font-medium">{t("card.switch")}</label>
        <p className="text-sm text-muted-foreground">{t("card.material")}{optIn ? ` ${t("card.optOut")}` : ""}</p>
      </div>
      <Switch id={switchId} checked={optIn && eligible} disabled={!canEdit || !eligible || Boolean(managedAt) || (!community && !listing)} aria-describedby={`${switchId}-state`}
        onCheckedChange={(value) => { if (community) community.onOptInChange(value); else void apply({ optIn: value }); }} />
    </div>
    {!canEdit && <p className="text-sm text-muted-foreground">{t("card.readOnly")}</p>}
    {canEdit && !eligible && <p className="text-sm text-muted-foreground">{t("card.needsPublished")}</p>}
    {loadFailed && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{t("card.loadFailed")}<Button type="button" variant="outline" size="responsive" onClick={() => void reload()}>{t("card.reload")}</Button></AlertDescription></Alert>}
    {listing && <div id={`${switchId}-state`} className="flex flex-wrap items-center gap-2 text-sm">
      <StatusBadge tone={reviewTone(state)} label={t(`card.status.${state}`)} dot />
      {statusText && <span className="break-words text-muted-foreground">{statusText}</span>}
      {canEdit && optIn && state === "rejected" && <Button type="button" variant="outline" size="responsive" onClick={() => void apply({ requestReview: true })}>{t("card.resubmit")}</Button>}
    </div>}
    {listing && <div className="grid gap-4 sm:grid-cols-2">
      <Field><FieldLabel htmlFor={`${switchId}-category`}>{t("card.category")}</FieldLabel>
        <NativeSelect id={`${switchId}-category`} className="w-full" disabled={!canEdit} value={listing.category ?? ""} onChange={(e) => void apply({ category: (e.target.value || null) as DiscoverCategory | null })}>
          <NativeSelectOption value="">{t("card.unset")}</NativeSelectOption>
          {discoverCategories.map((key) => <NativeSelectOption key={key} value={key}>{t(`categories.${key}`)}</NativeSelectOption>)}</NativeSelect></Field>
      <Field><FieldLabel htmlFor={`${switchId}-language`}>{t("card.language")}</FieldLabel>
        <NativeSelect id={`${switchId}-language`} className="w-full" disabled={!canEdit} value={listing.language ?? ""} onChange={(e) => void apply({ language: e.target.value || null })}>
          <NativeSelectOption value="">{t("card.unset")}</NativeSelectOption>
          {listing.language && !(discoverLanguages as readonly string[]).includes(listing.language) && <NativeSelectOption value={listing.language}>{languageName(listing.language)}</NativeSelectOption>}
          {discoverLanguages.map((code) => <NativeSelectOption key={code} value={code}>{languageName(code)}</NativeSelectOption>)}</NativeSelect></Field>
    </div>}
    <p ref={live} role="status" className="min-h-5 text-sm text-muted-foreground">{saveState === "saving" ? t("card.saving") : saveState === "saved" ? t("card.saved") : ""}</p>
    {saveState === "failed" && <Alert variant="destructive" role="alert"><AlertDescription>{t("card.failed")}</AlertDescription></Alert>}
    {saveState === "conflict" && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{t("card.conflict")}<Button type="button" variant="outline" size="responsive" onClick={() => void reload()}>{t("card.reload")}</Button></AlertDescription></Alert>}
    {managedAt && <p className="text-sm text-muted-foreground">{t("card.communityManaged")} <Link href={managedAt} prefetch={false} className="underline">{t("card.openSettings")}</Link></p>}
  </div>;
}
