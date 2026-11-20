import "server-only";
import type { Database } from "../db/client";
import type { ShellSettings } from "../lib/settings-sections";
import { joinedCommunities } from "./community-joining";
import { memberProfilesEnabled } from "./community-profile-details";
import { SOCIAL_TEST_CREDENTIAL, socialScreensEnabled } from "./social-publish-gate";

/**
 * What the Settings pop-up may offer, decided on the server for the signed-in person. Profile appears only while the member-profile routes are on
 * (never in production) and lists the communities the person belongs to; the social test credential (the fixed public value the non-production
 * gate hands to the Social accounts page) is included only when `socialStaff` is true, so a member's page payload never carries it.
 */
export async function shellSettings(db: Database, userId: string, { socialStaff = false }: { socialStaff?: boolean } = {}): Promise<ShellSettings> {
  return {
    communities: memberProfilesEnabled() ? await joinedCommunities(db, userId) : undefined,
    socialTestCredential: socialStaff && socialScreensEnabled() ? SOCIAL_TEST_CREDENTIAL : undefined,
  };
}
