import type { SocialPlatform } from "./platforms";

/** Product names are proper nouns and are not translated. No brand logos or images are bundled: a short monogram stands in for the logo. */
export const platformLabels: Record<SocialPlatform, string> = {
  twitter: "X", instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", pinterest: "Pinterest",
  reddit: "Reddit", bluesky: "Bluesky", threads: "Threads", googlebusiness: "Google Business Profile", telegram: "Telegram", snapchat: "Snapchat",
  whatsapp: "WhatsApp", discord: "Discord", slack: "Slack", wordpress: "WordPress", shopify: "Shopify", wix: "Wix", webflow: "Webflow",
  rcs: "RCS", imessage: "iMessage", line: "LINE", wechat: "WeChat", sms: "SMS",
};
export const platformMonograms: Record<SocialPlatform, string> = {
  twitter: "X", instagram: "Ig", facebook: "f", linkedin: "in", tiktok: "Tk", youtube: "Yt", pinterest: "P", reddit: "R", bluesky: "Bs", threads: "@",
  googlebusiness: "G", telegram: "Tg", snapchat: "Sc", whatsapp: "Wa", discord: "D", slack: "S", wordpress: "W", shopify: "Sh", wix: "Wx", webflow: "Wf",
  rcs: "Rc", imessage: "iM", line: "L", wechat: "Wc", sms: "Sm",
};
