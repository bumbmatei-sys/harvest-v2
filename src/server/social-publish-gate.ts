import "server-only";
import { notFound } from "next/navigation";
import { communitiesEnabled } from "./communities-mode";
import { socialPlatforms } from "../lib/social/platforms";
import { FakeProvider } from "./social/fake-provider";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { defaultSocialDeps, type SocialDeps } from "./social/registry";

/**
 * Non-production gate for the Social Publish routes and screens, so they can be exercised in development and browser tests.
 * - Open only when NODE_ENV and VERCEL_ENV are not "production" and Communities are on (the same switch the other Public mode screens use). No new
 *   environment switch exists, and nothing here can be turned on in production.
 * - When open, the routes use ONE in-memory fake provider that accepts only a fixed synthetic test credential and never touches a network. The vendor adapter is
 *   never built through this path.
 * - SOCIAL_INTEGRATION_ENABLED and ZERNIO_LIVE_NETWORK stay the literal `false`, and the registry sender accessor still throws: nothing is sent to a person.
 */
export function socialPublishGateOpen(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production" && communitiesEnabled(env);
}
/** The synthetic credential and one synthetic account per platform the test provider offers; these are fixed public test values, not secrets. */
export const SOCIAL_TEST_CREDENTIAL = "harvest-test-credential";
export const socialTestAccountRef = (platform: string) => `test-${platform}`;
const fake = new FakeProvider({ validSecret: SOCIAL_TEST_CREDENTIAL, accounts: socialPlatforms.map((platform) => ({ platform, accountRef: socialTestAccountRef(platform), displayName: `Test ${platform}` })) });
/** The dependencies every Publish route uses: the test deps while the gate is open, the hard-off defaults otherwise. */
export function socialRouteDeps(env: Record<string, string | undefined> = process.env): SocialDeps {
  return socialPublishGateOpen(env) ? { enabled: true, provider: (id) => { if (id === "fake") return fake; throw new AccessError(404, message("Errors.workspaceUnavailable")); }, now: () => new Date() } : defaultSocialDeps();
}
export const socialScreensEnabled = socialPublishGateOpen;
/** Social pages answer 404 before any session work while the gate is closed. */
export function requireSocialScreens() { if (!socialPublishGateOpen()) notFound(); }
