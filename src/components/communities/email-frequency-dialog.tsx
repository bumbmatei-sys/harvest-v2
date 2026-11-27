/** Derived from Shadcn UI Kit item dashboard-modal15 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Community screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { useRequest } from "@/hooks/use-request";
import { emailFrequencies, type EmailFrequency } from "@/lib/notifications";
import { notify } from "@/lib/toast";

/** C15c: how often a community may email the member, as the kit's alert preferences window. Save sends the choice through the email route. */
export function EmailFrequencyDialog({ slug, value }: { slug: string; value: EmailFrequency }) {
  const t = useTranslations("CommunityNotifications"), request = useRequest(), router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [preference, setPreference] = React.useState<EmailFrequency>(value);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");

  async function save() {
    if (preference === value) { setOpen(false); return; }
    setBusy(true); setError("");
    const result = await request(`/api/communities/${slug}/notifications/email`, { method: "PUT", body: { frequency: preference } });
    setBusy(false);
    if (!result.ok) { setError(result.error); notify.error(result.error, { id: "community-notification-settings" }); return; }
    notify.success(t("savedToast"), { id: "community-notification-settings" });
    setOpen(false); router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) { setPreference(value); setError(""); } setOpen(next); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="responsive" aria-label={t("email.change")}>{t("email.changeShort")}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("email.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("email.dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <RadioGroup
          aria-label={t("email.dialogTitle")}
          value={preference}
          onValueChange={(next) => setPreference(next as EmailFrequency)}
          className="gap-4"
        >
          {emailFrequencies.map((option) => (
            <Field key={option} orientation="horizontal" className="min-h-11">
              <RadioGroupItem value={option} id={`email-${option}`} aria-describedby={`email-${option}-hint`} />
              <FieldContent>
                <FieldLabel htmlFor={`email-${option}`}>
                  {t(`email.${option}`)}
                </FieldLabel>
                <FieldDescription id={`email-${option}-hint`}>{t(`email.${option}Hint`)}</FieldDescription>
              </FieldContent>
            </Field>
          ))}
        </RadioGroup>

        <DialogFooter>
          <Button variant="outline" size="responsive" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button size="responsive" disabled={busy} onClick={() => void save()}>{busy && <Spinner decorative size="sm" />}{t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
