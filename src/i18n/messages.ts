import { createTranslator } from "next-intl";
import messages from "../../messages/en.json";
import type { Locale } from "./locale";

const english = createTranslator({ locale: "en", messages });
export type MessageKey = Parameters<typeof english>[0];

/** Pure catalogue access for domain validation, service errors and background email. */
export function message(key: MessageKey, values?: Record<string, string | number>, locale: Locale = "en") {
  return (locale === "en" ? english : createTranslator({ locale, messages }))(key, values);
}

/** Translate known service messages; unknown provider text is never shown to a user. */
export function errorMessage(error: { message?: string; code?: string } | string | undefined, fallback: MessageKey = "Errors.requestFailed", locale: Locale = "en") {
  const detail = typeof error === "string" ? error : error?.message;
  const known = Object.entries(messages.Errors).find(([, value]) => value === detail);
  if (known) return message(`Errors.${known[0]}` as MessageKey, undefined, locale);
  if (typeof error === "object" && error) {
    if (error.code === "INVALID_OTP") return message("Errors.invalidCode", undefined, locale);
    if (error.code === "OTP_EXPIRED") return message("Errors.expiredCode", undefined, locale);
  }
  return message(fallback, undefined, locale);
}
