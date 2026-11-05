export const locales = ["en"] as const;
export type Locale = (typeof locales)[number];

function supported<T extends string>(value: string | null | undefined, available: readonly T[]): T | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return available.find((locale) => normalized === locale || normalized.startsWith(`${locale}-`));
}

/** Resolve explicit preferences before the weighted browser language list. */
export function resolveFromLocales<T extends string>(user: string | null | undefined, cookie: string | null | undefined, acceptLanguage: string | null | undefined, available: readonly T[], fallback: T): T {
  const preferred = supported(user, available) ?? supported(cookie, available);
  if (preferred) return preferred;
  const languages = (acceptLanguage ?? "").split(",").map((part, index) => {
    const [language, ...parameters] = part.trim().split(";");
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const raw = quality?.trim().slice(2);
    const q = raw === undefined ? 1 : /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw) ? Number(raw) : 0;
    return { language, q, index };
  }).filter(({ q }) => q > 0).sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { language } of languages) {
    const locale = supported(language, available);
    if (locale) return locale;
  }
  return fallback;
}

export function resolveLocale(user: string | null | undefined, cookie: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  return resolveFromLocales(user, cookie, acceptLanguage, locales, "en");
}
