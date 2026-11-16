/** Result of a confirm handler: nothing means done; a string is a failure message to show while the dialog stays open. */
export type ConfirmResult = void | string | Promise<void | string>;
export type ConfirmOutcome = { ok: true } | { ok: false; message: string };

/** Runs a confirm handler and turns every way it can fail (returned text, thrown error) into one outcome. */
export async function runConfirm(handler: () => ConfirmResult, fallbackMessage: string): Promise<ConfirmOutcome> {
  try {
    const result = await handler();
    return typeof result === "string" && result !== "" ? { ok: false, message: result } : { ok: true };
  } catch {
    return { ok: false, message: fallbackMessage };
  }
}
