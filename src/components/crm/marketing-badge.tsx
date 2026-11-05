import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

/** Effective marketing-email state, as computed by the consent ledger rule. */
export function MarketingBadge({ state }: { state: "granted" | "withdrawn" | "none" }) {
  const t = useTranslations("Crm");
  return <Badge variant="secondary" className={state === "granted" ? "bg-success-tint text-success" : state === "withdrawn" ? "bg-warning-tint text-warning" : "text-muted-foreground"}>{t(`marketing.${state}`)}</Badge>;
}
