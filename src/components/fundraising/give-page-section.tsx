/** Derived from Shadcn UI Kit item form-layout14 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Giving screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ExternalLink, Eye } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
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

function ProfileRow({
  title,
  description,
  htmlFor,
  invalid,
  children,
}: {
  title: string;
  description?: ReactNode;
  htmlFor?: string;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <Field
      data-invalid={invalid}
      className="grid gap-3 py-5 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-8"
    >
      <FieldContent>
        {htmlFor ? (
          <FieldLabel htmlFor={htmlFor}>{title}</FieldLabel>
        ) : (
          <FieldTitle>{title}</FieldTitle>
        )}
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </Field>
  );
}

/**
 * "Public page" on the fundraiser screen (owners and admins), as the kit's public profile form: cover band, title, then label-left rows for the
 * /give/<slug> address (fixed once the fundraiser is open), the copyable link, description, the show-amount choice and the cover (the shared
 * scanned-upload cover picker), with a save footer and a preview rendered with the public page's own view. Saving and the cover are audited on the
 * server. The page is public only while the fundraiser is open; nothing here publishes anything else.
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
  const [isSubmitting, setSubmitting] = useState(false), [error, setError] = useState(""), [attempted, setAttempted] = useState(false), [previewOpen, setPreviewOpen] = useState(false);
  const cover = useEventCoverUrl(endpoint, coverFileId);
  const archived = status === "archived", locked = Boolean(page) && status !== "draft", live = Boolean(page) && status === "published";
  const problem = giveSlugProblem(slug.trim().toLowerCase());
  const url = `${origin}${givePath(page?.slug ?? slug)}`;
  const changed = !page || slug !== page.slug || (description.trim() || null) !== page.description || showAmount !== page.showAmount;
  const left = giveLimits.description - description.length;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault(); setAttempted(true); setError("");
    if (problem) return;
    setSubmitting(true);
    const result = await request<GivePageSettings>(endpoint, { method: "PUT", body: { slug: slug.trim().toLowerCase(), description, showAmount, ...(version ? { version } : {}) } });
    setSubmitting(false);
    if (!result.ok) { setError(result.error); return; }
    setSlug(result.data.slug); setDescription(result.data.description ?? ""); setVersion(result.data.version);
    notify.success(t("saved")); router.refresh();
  }

  const actions = (
    <>
      {preview && (
      <Button
        type="button"
        variant="outline"
        className="min-h-11 flex-1 sm:flex-none lg:min-h-9"
        onClick={() => setPreviewOpen(true)}
      >
        <Eye />
        {t("preview")}
      </Button>
      )}
      {!archived && (
      <Button
        type="submit"
        className="min-h-11 flex-1 sm:flex-none lg:min-h-9"
        disabled={!changed || isSubmitting || coverBusy}
      >
        {isSubmitting && <Spinner />}
        {isSubmitting ? t("saving") : t("save")}
      </Button>
      )}
    </>
  );

  return (
    <form
      noValidate
      onSubmit={(event) => void onSubmit(event)}
      className="w-full"
      data-give-section
    >
      <Card className="gap-0 pt-0">
        <div className="bg-muted relative h-28 overflow-hidden rounded-t-xl sm:h-36">
          {cover.url && (
            // eslint-disable-next-line @next/next/no-img-element -- a one-minute signed preview address; not optimisable
            <img
              src={cover.url}
              alt={t("coverPreview")}
              className="size-full object-cover"
              onError={cover.failed}
            />
          )}
        </div>

        <div className="flex flex-col gap-4 px-4 sm:flex-row sm:items-start sm:gap-5 sm:px-6">
          <div className="min-w-0 flex-1 space-y-1 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{t("title")}</h2>
              {page && <StatusBadge tone={live ? "success" : "neutral"} label={live ? t("live") : t("notLive")} dot />}
            </div>
            <p className="text-muted-foreground text-sm">
              {!page ? t("intro") : live ? t("liveHint") : status === "draft" ? t("notLiveHint") : t("closedHint")}
            </p>
          </div>
        </div>

        <CardContent className="pt-6">
          {error && (
            <Alert variant="destructive" role="alert" className="mb-6">
              <AlertDescription className="break-all">
                {error}
              </AlertDescription>
            </Alert>
          )}

          <div className="divide-y">
            <ProfileRow
              title={t("address")}
              description={locked ? t("addressLocked") : undefined}
              htmlFor="give-slug"
              invalid={attempted && !!problem}
            >
              <InputGroup className="min-h-11 lg:min-h-9">
                <InputGroupAddon>
                  <InputGroupText>{givePath("")}</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="give-slug"
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  value={slug}
                  maxLength={giveLimits.slugMax}
                  required
                  readOnly={locked || archived}
                  aria-invalid={attempted && !!problem}
                  onChange={(event) => setSlug(event.target.value.toLowerCase())}
                />
              </InputGroup>
              {attempted && problem && (
                <FieldError>{problem === "reserved" ? t("reservedSlug") : t("invalidSlug")}</FieldError>
              )}
            </ProfileRow>

            {page && (
            <ProfileRow
              title={t("link")}
            >
              <div className="flex flex-wrap items-center gap-2">
                <code className="bg-muted/50 min-w-0 flex-1 rounded-md border px-3 py-2 text-sm break-all" data-give-link>{url}</code>
                <div className="flex flex-wrap gap-2">
                  <CopyButton value={url} label={t("copyLink")} />
                  {live && (
                  <Button asChild variant="outline" size="sm" className="max-lg:min-h-11">
                    <a href={givePath(page.slug)} target="_blank" rel="noopener noreferrer">
                      <ExternalLink />
                      {t("openPage")}
                    </a>
                  </Button>
                  )}
                </div>
              </div>
            </ProfileRow>
            )}

            <ProfileRow
              title={t("description")}
              htmlFor="give-description"
            >
              <InputGroup>
                <InputGroupTextarea
                  id="give-description"
                  rows={5}
                  value={description}
                  maxLength={giveLimits.description}
                  disabled={archived}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </InputGroup>
              <FieldDescription className="tabular-nums">
                {t("charactersLeft", { count: left })}
              </FieldDescription>
            </ProfileRow>

            <ProfileRow
              title={t("amount")}
            >
              <Field orientation="horizontal" className="min-h-11">
                <Checkbox
                  id="give-show-amount"
                  checked={showAmount}
                  disabled={archived}
                  onCheckedChange={(checked) => setShowAmount(checked === true)}
                />
                <FieldLabel
                  htmlFor="give-show-amount"
                  className="font-normal"
                >
                  {t("showAmount")}
                </FieldLabel>
              </Field>
              {!showAmount && (
                <FieldDescription>
                  {t("showAmountHint")}
                </FieldDescription>
              )}
            </ProfileRow>

            {!archived && (
            <ProfileRow
              title={t("cover")}
            >
              <EventCoverPicker endpoint={endpoint} saved={Boolean(version)} coverFileId={coverFileId} version={version ?? 1} url={cover.url} onUrlFailed={cover.failed}
                onChange={(change) => { setCoverFileId(change.coverFileId); setVersion(change.version); router.refresh(); }} onBusyChange={setCoverBusy} disabled={isSubmitting} namespace="GivePage.cover" variant="square" />
            </ProfileRow>
            )}
          </div>
        </CardContent>

        <CardFooter className="mt-6 flex-wrap gap-3">
          <p className="text-muted-foreground mr-auto text-sm">
            {changed ? t("unsaved") : t("allSaved")}
          </p>
          <div className="flex w-full gap-2 sm:w-auto">{actions}</div>
        </CardFooter>
      </Card>

      {preview && <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{t("previewTitle")}</DialogTitle></DialogHeader>
          <div data-give-preview><GivePageView view={preview.view} coverUrl={cover.url} methods={preview.methods} layout="narrow" preview /></div>
        </DialogContent>
      </Dialog>}
    </form>
  );
}
