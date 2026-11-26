"use client";
import { CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { WizardStep } from "@/lib/campaign-wizard";
import { outreachBlocked, outreachKeys, setOutreach, type OutreachKey, type WizardForm } from "@/lib/campaign-wizard-form";
import type { SetStep } from "@/components/campaigns/wizard-steps";

/**
 * Step 7: how participants connect with the campaign, as six switch cards with the PRD's names. All start off and nothing here publishes or sends
 * anything. A card that cannot be on yet says why (follow-up, account invitations and referrals need registration or the response QR; community discovery
 * needs account invitations). Registration and the response QR also need their tool turned on in Campaign Features; when it is off a link says so.
 * Finish records the choices, and for the response QR it adds one unpublished source to the Connect links.
 */
export function ConnectStep({ form, set, disabled, onEdit }: { form: WizardForm; set: SetStep; disabled: boolean; onEdit: (step: WizardStep) => void }) {
  const t = useTranslations("CampaignWizard.connect"), blocked = outreachBlocked(form.connect);
  const toggle = (key: OutreachKey, on: boolean) => set("connect", (current) => ({ ...current, connect: setOutreach(current.connect, key, on) }), 120);
  const missingTool: Partial<Record<OutreachKey, string>> = {
    registration: form.connect.registration && !form.tools.modules.includes("registration_forms") ? t("needsRegistrationTool") : undefined,
    qrResponse: form.connect.qrResponse && !form.tools.modules.includes("qr_response_forms") ? t("needsQrTool") : undefined,
  };
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="group" aria-label={t("groupLabel")}>
      {outreachKeys.map((key) => {
        const reason = blocked[key], name = t(`options.${key}`), on = form.connect[key];
        return <Label key={key} htmlFor={`connect-${key}`} className="flex min-h-11 items-start justify-between gap-3 rounded-xl border bg-card p-4 font-normal has-data-[state=checked]:border-primary has-data-[state=checked]:bg-muted/50 has-[button:disabled]:opacity-60">
          <span className="flex min-w-0 flex-col gap-1.5"><span className="text-sm font-medium">{name}</span>
            {reason && !on && <span className="text-xs text-muted-foreground">{t(`reasons.${reason}`)}</span>}
            {missingTool[key] && <span className="text-xs text-muted-foreground">{missingTool[key]}</span>}</span>
          <Switch id={`connect-${key}`} checked={on} disabled={disabled || (!!reason && !on)} aria-label={t("toggle", { name })} onCheckedChange={(next) => toggle(key, next)} />
        </Label>;
      })}
    </div>
    {(missingTool.registration || missingTool.qrResponse) && <Alert role="status"><CircleAlert aria-hidden="true" /><AlertDescription className="flex flex-wrap items-center gap-3">{t("toolsMissing")}
      <Button type="button" variant="outline" className="min-h-11" onClick={() => onEdit("tools")}>{t("goToTools")}</Button></AlertDescription></Alert>}
    <p className="text-sm text-muted-foreground">{t("nothingPublished")}</p>
  </div>;
}
