import { PowerOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useSendEnabled } from "@/components/social/auto-dm/sender-state";

/** Sending is hard-off (SOCIAL_AUTO_DM_SENDER_ENABLED is a literal false): the screens say so on every page, in every state. */
export function HardOffNotice({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("SocialAutoDm.hardOff"), sendEnabled = useSendEnabled();
  if (sendEnabled) return null;
  return <Alert data-testid="hard-off-notice" role="note"><PowerOff aria-hidden="true" /><AlertTitle>{t("title")}</AlertTitle>
    {!compact && <AlertDescription>{t("body")}</AlertDescription>}</Alert>;
}
