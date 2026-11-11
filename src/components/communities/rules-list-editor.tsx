"use client";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** The community's rules as a list (Eden "Rules" card): one input per rule, add and remove. */
export function RulesListEditor({ rules, onChange, disabled = false }: { rules: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const t = useTranslations("CommunityRules");
  return <div className="space-y-2">
    <ol className="space-y-2" aria-label={t("listLabel")}>
      {rules.map((rule, index) => <li key={index} className="flex items-center gap-2">
        <Input className="min-h-11" value={rule} maxLength={300} disabled={disabled} placeholder={t("placeholder")} aria-label={t("ruleNumber", { number: index + 1 })}
          onChange={(e) => onChange(rules.map((r, i) => i === index ? e.target.value : r))} />
        <Button type="button" variant="ghost" size="icon" className="size-11" disabled={disabled} onClick={() => onChange(rules.filter((_, i) => i !== index))} aria-label={t("remove", { number: index + 1 })}><X aria-hidden="true" /></Button>
      </li>)}
    </ol>
    {rules.length < 20 && <Button type="button" variant="outline" className="min-h-11" disabled={disabled} onClick={() => onChange([...rules, ""])}><Plus aria-hidden="true" />{t("add")}</Button>}
  </div>;
}
