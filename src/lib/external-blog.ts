export const externalBlogPlatforms = ["wordpress", "shopify", "wix", "webflow"] as const;
export type ExternalBlogPlatform = typeof externalBlogPlatforms[number];
export const isExternalBlogPlatform = (platform: string): platform is ExternalBlogPlatform =>
  (externalBlogPlatforms as readonly string[]).includes(platform);

export const externalBlogCapabilities = {
  wordpress: { nativeSchedule: true, canonical: "unsupported", seo: false },
  shopify: { nativeSchedule: true, canonical: "unsupported", seo: true },
  wix: { nativeSchedule: true, canonical: "unsupported", seo: true },
  webflow: { nativeSchedule: false, canonical: "unsupported", seo: false },
} as const;

export type ExternalArticleInput = {
  title: string;
  bodyHtml: string;
  handle?: string;
  excerpt?: string;
  tags?: string[];
  image?: { url: string; altText?: string };
  seo?: { title?: string; description?: string };
  isPublished?: boolean;
  publishDate?: string;
};

export type ExternalBlog = { id: string; title: string };
export type RemoteBlogArticle = {
  id: string;
  handle: string;
  url: string | null;
  title: string;
  bodyHtml: string | null;
  excerpt: string | null;
  tags: string[];
  image: { url: string; altText: string | null } | null;
  published: boolean;
  scheduledAt: string | null;
};
export type ExternalBlogTarget = { platform: ExternalBlogPlatform; accountRef: string; blogRef: string };
