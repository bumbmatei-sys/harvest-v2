"use client";
import { useTranslations } from "next-intl";
import type { AutoDmRule, AutoDmTrigger } from "@/lib/social/auto-dm";
import { cooldownUnit } from "@/lib/social/auto-dm-ui";

/** Catalogue text for the parts of a rule, so the list, the review and the editor's summary describe a rule in the same words. */
export function useRuleLabels() {
  const t = useTranslations("SocialAutoDm");
  return {
    trigger: (trigger: AutoDmTrigger) => t(`triggers.${trigger}.name`),
    scope: (rule: Pick<AutoDmRule, "trigger" | "postId" | "postRef" | "entryKey">) => rule.trigger === "comment" ? (rule.postId ? t("scope.harvestPost") : rule.postRef ? t("scope.reference") : t("scope.any"))
      : rule.entryKey ? t("scope.entry", { key: rule.entryKey }) : t("scope.every"),
    cooldown: (minutes: number) => { const [unit, amount] = cooldownUnit(minutes); return t(`cooldown.${unit}`, { count: amount }); },
    hours: (mode: AutoDmRule["hours"]) => t(`limits.hoursMode.${mode}`),
    purpose: (purpose: AutoDmRule["purpose"]) => t(`purposes.${purpose}`),
    mode: (mode: AutoDmRule["match"]["mode"]) => t(`match.modes.${mode}`),
  };
}
