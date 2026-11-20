export const socialPlatforms = [
  "twitter", "instagram", "facebook", "linkedin", "tiktok", "youtube", "pinterest", "reddit",
  "bluesky", "threads", "googlebusiness", "telegram", "snapchat", "whatsapp", "discord", "slack",
  "wordpress", "shopify", "wix", "webflow", "rcs", "imessage", "line", "wechat", "sms",
] as const;
export type SocialPlatform = typeof socialPlatforms[number];
export const draftTypes = ["post", "article", "story"] as const;
export type DraftType = typeof draftTypes[number];
export const isSocialPlatform = (value: unknown): value is SocialPlatform => socialPlatforms.some(platform => platform === value);

type Availability = "supported" | "conditional" | "unavailable";
type Capabilities = {
  postTypes: Record<DraftType, Availability>;
  firstComment: Availability;
  repost: Availability;
  madeWithAi: Availability;
  altText: Availability;
  link: "inline" | "target" | "unavailable";
  dms: Availability;
  comments: Availability;
};
const unavailable: Capabilities = {
  postTypes: { post: "unavailable", article: "unavailable", story: "unavailable" },
  firstComment: "unavailable", repost: "unavailable", madeWithAi: "unavailable", altText: "unavailable",
  link: "unavailable", dms: "unavailable", comments: "unavailable",
};
function posting(options: Partial<Capabilities> = {}): Capabilities {
  return { ...unavailable, postTypes: { ...unavailable.postTypes, post: "supported" }, repost: "supported", link: "inline", ...options };
}

export const platformCapabilities: Record<SocialPlatform, Capabilities> = {
  twitter: posting({
    postTypes: { post: "supported", article: "conditional", story: "unavailable" },
    madeWithAi: "supported", altText: "supported", dms: "conditional", comments: "supported",
  }),
  instagram: posting({
    postTypes: { post: "supported", article: "unavailable", story: "supported" },
    firstComment: "supported", madeWithAi: "supported", altText: "supported", link: "unavailable", dms: "supported", comments: "supported",
  }),
  facebook: posting({
    postTypes: { post: "supported", article: "unavailable", story: "supported" },
    firstComment: "supported", altText: "supported", dms: "supported", comments: "supported",
  }),
  linkedin: posting({ firstComment: "supported", altText: "supported", comments: "conditional" }),
  tiktok: posting({ madeWithAi: "conditional", dms: "conditional", comments: "conditional" }),
  youtube: posting({ madeWithAi: "supported", comments: "supported" }),
  pinterest: posting({ madeWithAi: "supported", altText: "supported", link: "target" }),
  reddit: posting({ link: "target", dms: "supported", comments: "supported" }),
  bluesky: posting({ altText: "supported", dms: "supported", comments: "supported" }),
  threads: posting({ firstComment: "supported", altText: "supported", comments: "supported" }),
  googlebusiness: posting({ link: "target" }),
  telegram: posting({ dms: "conditional" }),
  snapchat: unavailable,
  whatsapp: { ...unavailable, dms: "conditional" },
  discord: posting({ dms: "unavailable" }),
  slack: posting({ dms: "conditional" }),
  wordpress: unavailable, shopify: unavailable, wix: unavailable, webflow: unavailable,
  rcs: { ...unavailable, dms: "conditional" },
  imessage: { ...unavailable, dms: "conditional" },
  line: { ...unavailable, dms: "conditional" },
  wechat: { ...unavailable, dms: "conditional" },
  sms: { ...unavailable, dms: "conditional" },
};

export const inboxKinds = ["dm", "comment", "mention", "story"] as const;
export type InboxKind = typeof inboxKinds[number];
export const inboxCapabilityVersion = "zernio-f98ece5";
export type InboxCapabilities = {
  conversationRead: Availability;
  messageReply: Availability;
  commentRead: Availability;
  commentReply: Availability;
  privateReply: Availability;
  messageMedia: Availability;
  commentMedia: Availability;
  mentions: Availability;
  mentionReply: Availability;
  storyReplies: Availability;
  liveSearch: Availability;
  quoteReply: Availability;
};

const searchPlatforms: readonly SocialPlatform[] = ["facebook", "instagram", "telegram", "whatsapp", "sms", "rcs", "slack", "imessage", "line", "wechat"];
const mediaPlatforms: readonly SocialPlatform[] = ["facebook", "instagram", "twitter", "telegram", "whatsapp", "slack", "imessage", "sms", "rcs", "line", "wechat", "tiktok", "bluesky"];
const mentionPlatforms: readonly SocialPlatform[] = ["facebook", "instagram", "linkedin"];
const quotePlatforms: readonly SocialPlatform[] = ["whatsapp", "telegram", "slack"];

export function inboxCapabilities(platform: SocialPlatform): InboxCapabilities {
  const { dms, comments } = platformCapabilities[platform];
  const meta = platform === "facebook" || platform === "instagram";
  return {
    conversationRead: dms,
    messageReply: dms === "unavailable" ? "unavailable" : "conditional",
    commentRead: comments,
    commentReply: comments === "unavailable" ? "unavailable" : "conditional",
    privateReply: meta ? "conditional" : "unavailable",
    messageMedia: mediaPlatforms.includes(platform) ? "conditional" : "unavailable",
    commentMedia: platform === "facebook" ? "conditional" : "unavailable",
    mentions: mentionPlatforms.includes(platform) ? "conditional" : "unavailable",
    mentionReply: platform === "instagram" ? "conditional" : "unavailable",
    storyReplies: platform === "instagram" ? "conditional" : "unavailable",
    liveSearch: searchPlatforms.includes(platform) ? "conditional" : "unavailable",
    quoteReply: quotePlatforms.includes(platform) ? "conditional" : "unavailable",
  };
}
