import { AccessError } from "../permissions";
import { message } from "../../i18n/messages";

// Intentionally a literal constant, not an environment toggle (same pattern as SOCIAL_INTEGRATION_ENABLED). While false, every unified Discover route answers the same neutral 404.
// Production can never enable it without a separate reviewed change. The legacy communities-only Discover endpoint is untouched by this switch.
export const DISCOVER_SERVER_ENABLED = false;
export type DiscoverDeps = { enabled: boolean; now: () => Date };
export const defaultDiscoverDeps = (): DiscoverDeps => ({ enabled: DISCOVER_SERVER_ENABLED, now: () => new Date() });
export const unavailable = () => new AccessError(404, message("Errors.workspaceUnavailable"));
export const assertDiscoverEnabled = (deps: DiscoverDeps) => { if (!deps.enabled) throw unavailable(); };
