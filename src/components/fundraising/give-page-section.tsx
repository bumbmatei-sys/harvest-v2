"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ExternalLink, Eye, Globe } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/copy-button";
import { StatusBadge } from "@/components/status-badge";
import { EventCoverPicker } from "@/components/events/event-cover-picker";
import { useEventCoverUrl } from "@/components/events/use-event-cover-url";
import { GivePageView } from "@/components/fundraising/give-page-view";
import { useRequest } from "@/hooks/use-request";
import { notify } from "@/lib/toast";
import { giveLimits, givePath, giveSlugProblem, suggestGiveSlug, type GivePageSettings, type GivePublicView } from "@/lib/give-page";
import type { FundraisingStatus } from "@/lib/fundraising";
import type { GivingPublicMethod } from "@/lib/ways-to-give";

/**
 * "Public page" on the fundraiser screen (owners and admins): the /give/<slug> address (fixed once the fundraiser is open), description, cover (the shared
 * scanned-upload cover picker), the show-amount switch, a copyable link and a preview rendered with the public page's own view. Saving and the cover are
 * audited on the server. The page is public only while the fundraiser is open; nothing here publishes anything else.
 */
export function GivePageSection({ tenantId, fundraisingId, title, status, origin, page, preview }: {
  tenantId: string; fundraisingId: string; title: string; status: FundraisingStatus; origin: string; page: GivePageSettings | null;
  preview: { view: GivePublicView; methods: GivingPublicMethod[] } | null;
}) {
  const t = useTranslations("GivePage.section"), router = useRouter(), request = useRequest();
  const endpoint = `/api/workspaces/${tenantId}/fundraising/${fundraisingId}/page`;
  const [slug, setSlug] = useState(page?.slug ?? suggestGiveSlug(title)), [description, setDescription] = useState(page?.description ?? "");
  const [showAmount, setShowAmount] = useState(page?.showAmount ?? true), [version, setVersion] = useState(page?.version ?? null);
  const [coverFileId, setCoverFileId] = useState(page?.coverFileId ?? null), [coverBusy, setCoverBusy] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [attempted, setAttempted] = useState(false), [previewOpen, setPreviewOpen] = useState(false);
  const cover = useEventCoverUrl(endpoint, coverFileId);
  const archived = status === "archived", locked = Boolean(page) && status !== "draft", live = Boolean(page) && status === "published";
  const problem = giveSlugProblem(slug.trim().toLowerCase());
  const url = `${origin}${givePath(page?.slug ?? slug)}`;
  const dirty = !page || slug !== page.slug || (description.trim() || null) !== page.description || showAmount !== page.showAmount;

  async function save(event: React.FormEvent) {
    event.preventDefault(); setAttempted(true); setError("");
    if (problem) return;
    setBusy(true);
    const result = await request<GivePageSettings>(endpoint, { method: "PUT", body: { slug: slug.trim().toLowerCase(), description, showAmount, ...(version ? { version } : {}) } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setSlug(result.data.slug); setDescription(result.data.description ?? ""); setVersion(result.data.version);
    notify.success(t("saved")); router.refresh();
  }

  return <Card data-give-section>
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
      <CardTitle><h2 className="flex items-center gap-2 text-base font-semibold"><Globe className="size-4 text-muted-foreground" aria-hidden="true" />{t("title")}</h2></CardTitle>
      {page && <StatusBadge tone={live ? "success" : "neutral"} label={live ? t("live") : t("notLive")} dot />}
    </CardHeader>
    <CardContent className="space-y-6">
      {page && !live && <p className="text-sm text-muted-foreground">{status === "draft" ? t("notLiveHint") : t("closedHint")}</p>}
      {page && <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border bg-muted/50 px-3 py-2 text-sm" data-give-link>{url}</code>
        <CopyButton value={url} label={t("copyLink")} />
        {live && <Button asChild variant="outline" className="min-h-11 lg:min-h-9"><a href={givePath(page.slug)} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />{t("openPage")}</a></Button>}
        {preview && <Button type="button" variant="outline" className="min-h-11 lg:min-h-9" onClick={() => setPreviewOpen(true)}><Eye aria-hidden="true" />{t("preview")}</Button>}
      </div>}
      <form className="space-y-5" onSubmit={(event) => void save(event)} noValidate>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <Field data-invalid={attempted && problem ? true : undefined}>
          <FieldLabel htmlFor="give-slug">{t("address")}</FieldLabel>
          <InputGroup className="min-h-11"><InputGroupAddon><InputGroupText>{givePath("")}</InputGroupText></InputGroupAddon>
            <InputGroupInput id="give-slug" dir="ltr" value={slug} maxLength={giveLimits.slugMax} required readOnly={locked || archived} autoComplete="off" spellCheck={false}
              aria-invalid={attempted && problem ? true : undefined} aria-describedby={locked ? "give-slug-locked" : undefined}
              onChange={(event) => setSlug(event.target.value.toLowerCase())} /></InputGroup>
          {locked && <FieldDescription id="give-slug-locked">{t("addressLocked")}</FieldDescription>}
          {attempted && problem && <FieldError>{problem === "reserved" ? t("reservedSlug") : t("invalidSlug")}</FieldError>}
        </Field>
        <Field>
          <FieldLabel htmlFor="give-description">{t("description")}</FieldLabel>
          <Textarea id="give-description" rows={6} value={description} maxLength={giveLimits.description} disabled={archived} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field orientation="horizontal">
          <div className="flex min-h-11 flex-1 flex-col justify-center gap-0.5">
            <Label htmlFor="give-show-amount">{t("showAmount")}</Label><p id="give-show-amount-hint" className="text-xs text-muted-foreground">{t("showAmountHint")}</p></div>
          <Switch id="give-show-amount" checked={showAmount} disabled={archived} onCheckedChange={setShowAmount} aria-describedby="give-show-amount-hint" />
        </Field>
        {!archived && <Button type="submit" className="min-h-11 lg:min-h-9" disabled={busy || coverBusy || !dirty}>{busy ? t("saving") : t("save")}</Button>}
      </form>
      {!archived && <EventCoverPicker endpoint={endpoint} saved={Boolean(version)} coverFileId={coverFileId} version={version ?? 1} url={cover.url} onUrlFailed={cover.failed}
        onChange={(change) => { setCoverFileId(change.coverFileId); setVersion(change.version); router.refresh(); }} onBusyChange={setCoverBusy} disabled={busy} namespace="GivePage.cover" />}
    </CardContent>
    {preview && <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{t("previewTitle")}</DialogTitle></DialogHeader>
        <div data-give-preview><GivePageView view={preview.view} coverUrl={cover.url} methods={preview.methods} layout="narrow" preview /></div>
      </DialogContent>
    </Dialog>}
  </Card>;
}
