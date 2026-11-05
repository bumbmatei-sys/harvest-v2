import { useTranslations } from "next-intl";
import Link from "next/link";
import { Copy } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Same-name records, shown for a human to compare. Harvest never merges people or
 * companies automatically; a name match alone is not evidence of identity.
 */
export function PossibleDuplicates({ items, kind }: { items: { id: string; name: string; href: string; hint?: string | null }[]; kind: "person" | "company" }) {
  const t = useTranslations("Crm");
  if (!items.length) return null;
  return <Alert><Copy aria-hidden="true" /><AlertTitle>{kind === "person" ? t("possibleDuplicatePeople", { count: items.length }) : t("possibleDuplicateCompanies", { count: items.length })}</AlertTitle>
    <AlertDescription><p>{t("possibleDuplicatesHelp")}</p>
      <ul className="mt-1 space-y-1">{items.map((item) => <li key={item.id}><Link href={item.href} className="font-medium text-foreground underline-offset-4 hover:underline">{item.name}</Link>{item.hint && <span className="text-muted-foreground">{t("hintSuffix", { hint: item.hint })}</span>}</li>)}</ul>
    </AlertDescription></Alert>;
}
