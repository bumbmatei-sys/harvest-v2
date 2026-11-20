import type { SocialPlatform } from "./platforms";

/** Product names are proper nouns and are not translated. Logos are in components/social/platform-logo.tsx. */
export const platformLabels: Record<SocialPlatform, string> = {
  twitter: "X", instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", pinterest: "Pinterest",
  reddit: "Reddit", bluesky: "Bluesky", threads: "Threads", googlebusiness: "Google Business Profile", telegram: "Telegram", snapchat: "Snapchat",
  whatsapp: "WhatsApp", discord: "Discord", slack: "Slack", wordpress: "WordPress", shopify: "Shopify", wix: "Wix", webflow: "Webflow",
  rcs: "RCS", imessage: "iMessage", line: "LINE", wechat: "WeChat", sms: "SMS",
};
