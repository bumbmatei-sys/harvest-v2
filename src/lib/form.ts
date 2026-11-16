/** Pure helpers for the shared form hook (src/hooks/use-harvest-form.ts). */

/** What a submit handler may return: nothing for success, or the server's refusal. `fields` maps field names to messages. */
export type SubmitFailure = { message?: string; fields?: Record<string, string | string[] | undefined> };

/**
 * Splits a refusal into messages for known fields and a form-level message. A field message for a name the form does not have is not
 * dropped: it becomes the form-level message when none was given, so a person always sees why the save failed.
 */
export function splitFailure(failure: SubmitFailure, known: readonly string[]): { fields: Record<string, string>; form: string | null } {
  const fields: Record<string, string> = {}, unknown: string[] = [];
  for (const [name, raw] of Object.entries(failure.fields ?? {})) {
    const message = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!message) continue;
    if (known.includes(name)) fields[name] = message; else unknown.push(message);
  }
  return { fields, form: failure.message?.trim() || unknown[0] || null };
}
