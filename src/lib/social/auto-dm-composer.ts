import { blankRule } from "./auto-dm-ui";
import type { AutoDmRule } from "./auto-dm";
import type { SocialPlatform } from "./platforms";

/** The composer's "Auto-DM people who comment a keyword" row. It is not part of the draft: the rule is created, off, for each Instagram or Facebook delivery once the post is scheduled or published. */
export type ComposerAutoDm = { on: boolean; keyword: string; reply: string; attested: boolean };
export const emptyComposerAutoDm = (): ComposerAutoDm => ({ on: false, keyword: "", reply: "", attested: false });
export const autoDmPlatforms = ["instagram", "facebook"] as const satisfies readonly SocialPlatform[];
export const supportsAutoDm = (platform: SocialPlatform) => (autoDmPlatforms as readonly SocialPlatform[]).includes(platform);
/** True when the row is off or has everything the server needs: a keyword, a reply and the service-only confirmation. */
export const autoDmReady = (value: ComposerAutoDm) => !value.on || (value.keyword.trim().length > 0 && value.reply.trim().length > 0 && value.attested);
/** A post-scoped comment rule bound to the Harvest delivery; the server checks the delivery belongs to the account and is live before it can be turned on. */
export function commentRuleFor(value: ComposerAutoDm, postId: string): AutoDmRule {
  const keyword = value.keyword.trim().slice(0, 80), rule = blankRule("comment");
  return { ...rule, name: `Comment keyword: ${keyword}`.slice(0, 120), postId, match: { ...rule.match, keywords: [keyword] }, response: { ...rule.response, text: value.reply.trim() }, purpose: "service", serviceOnly: true };
}
