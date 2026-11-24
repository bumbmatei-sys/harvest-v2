import { AccessError } from "../permissions";
import { message } from "../../i18n/messages";
import { newsletterEnabled } from "../newsletter";

/**
 * The only provider that exists is the synthetic one. Web-callable domain verification and the in-memory test mailbox are valid only while it is
 * active; they must be removed (verification moved to the worker path) before a live adapter is activated. HARVEST_NEWSLETTER_PROVIDER, when set,
 * must say "synthetic".
 */
export function syntheticProviderActive(env: Record<string, string | undefined> = process.env) {
  return newsletterEnabled(env) && (env.HARVEST_NEWSLETTER_PROVIDER ?? "synthetic") === "synthetic";
}

export function requireSyntheticProvider(env: Record<string, string | undefined> = process.env) {
  if (!syntheticProviderActive(env)) throw new AccessError(404, message("Errors.thisViewIsNotAvailable"));
}
