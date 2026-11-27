import { randomInt } from "node:crypto";
import { sharedScope } from "../lib/shared-scope";
import { qaShortcutNodeAccess, qaShortcutStages, qaSyntheticEmail } from "./qa-preview-gate";
import { workerSettings } from "./worker-settings";
import type { AuthOtpInput } from "./auth-otp-hooks-contract";

// QA-2: the request scope the test sign-in shortcut opens around its two internal OTP calls. The standard OTP hooks
// read it to keep the code in memory instead of sending it; without the scope (every ordinary request) they do nothing.
type ShortcutState = { email: string; code?: string };
export const qaShortcutScope = sharedScope<ShortcutState>("qa-shortcut");

/** Token and origin when the shortcut may run here, else null. Workers: preview, staging or local stage with the binding. Node: see the gate. */
export function qaShortcutAccess(): { token: string; origin: string } | null {
  const settings = workerSettings.getStore();
  if (settings) {
    return qaShortcutStages.includes(settings.stage) && settings.stage !== "production" && settings.qaPreviewToken
      ? { token: settings.qaPreviewToken, origin: settings.origin } : null;
  }
  return qaShortcutNodeAccess(process.env);
}

function activeFor(input: AuthOtpInput) {
  const state = qaShortcutScope.getStore();
  if (!state) return undefined;
  // The gate is checked again here, so a scope can never outlive a closed gate.
  return input.type === "sign-in" && state.email === input.email && qaSyntheticEmail(input.email) && qaShortcutAccess() ? state : null;
}

/** OTP generator hook: a fresh random code kept in the request scope. */
export function qaShortcutCode(input: AuthOtpInput): string | undefined {
  const state = activeFor(input);
  if (!state) return undefined;
  state.code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  return state.code;
}

/** Delivery hook: inside the scope nothing is ever sent; a request without the scope sends normally. */
export async function qaShortcutDeliver(input: AuthOtpInput, send: () => Promise<void>) {
  const state = qaShortcutScope.getStore();
  if (!state) return send();
  if (activeFor(input)?.code) return;
  throw new Error("QA_SHORTCUT_UNAVAILABLE");
}

export function qaShortcutAudit(): Record<string, string> {
  return qaShortcutScope.getStore()?.code ? { qa_test_sign_in: "shortcut" } : {};
}
