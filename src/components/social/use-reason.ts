"use client";
import { useTranslations } from "next-intl";

/** Plain-language text for a server rule code (character limit, media type, account state ...); an unknown code still reads as a sentence. */
export function useReason() {
  const t = useTranslations("SocialPublish.reasons");
  return (code: string) => t.has(code) ? t(code) : t("UNKNOWN");
}
