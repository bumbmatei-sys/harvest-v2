/** Joins the non-empty parts of a line of metadata ("Instagram · Grace Church · Mon 9:00"); the separator is punctuation, not wording. */
export const joinParts = (parts: readonly (string | null | undefined | false)[], separator = " · ") => parts.filter(Boolean).join(separator);
