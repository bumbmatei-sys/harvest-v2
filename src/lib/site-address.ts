import { sharedScope } from "./shared-scope";
import { blogPath } from "./blog";
import { publicLinkUrls } from "./connect-links";
import { publicFilePath } from "./files";

export interface SiteAddressEnvironment {
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string;
  MARKETING_ORIGIN?: string;
  LEGACY_ORIGINS?: string;
  AUTH_COOKIE_DOMAIN?: string;
  HARVEST_PRODUCTION_ORIGIN?: string;
  HARVEST_NEWSLETTER_ORIGIN?: string;
  NODE_ENV?: string;
}

const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];
function origin(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    if (url.href === `${url.origin}/` && (url.protocol === "https:" ||
        (url.protocol === "http:" && loopbackHosts.includes(url.hostname)))) return url.origin;
  } catch { /* Parsing errors can contain credentials. */ }
  throw new Error("SITE_ORIGIN_INVALID");
}

const syntheticNewsletterOrigin = "https://newsletter.example.test";
function newsletterAddress(value: string | undefined, app: string | undefined) {
  if (value) {
    const configured = origin(value);
    if (!configured.startsWith("https:")) throw new Error("NEWSLETTER_ORIGIN_INVALID");
    return configured;
  }
  // Delivery and preview rendering require HTTPS even in tests with a loopback app origin.
  return app?.startsWith("https:") ? app : syntheticNewsletterOrigin;
}

export function readSiteAddresses(env: SiteAddressEnvironment = process.env as SiteAddressEnvironment) {
  const app = origin(env.BETTER_AUTH_URL);
  const additionalTrusted = env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",").filter(Boolean) ?? [];
  if (additionalTrusted.some(item => item !== app)) throw new Error("AUTH_TRUSTED_ORIGINS_INVALID");
  const marketing = env.MARKETING_ORIGIN ? origin(env.MARKETING_ORIGIN) : app;
  const legacy = (env.LEGACY_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean).map(origin);
  if (legacy.includes(app) || legacy.includes(marketing)) throw new Error("LEGACY_ORIGIN_CONFLICT");

  const cookieDomain = env.AUTH_COOKIE_DOMAIN?.trim().toLowerCase().replace(/^\./, "") || undefined;
  if (cookieDomain) {
    const host = new URL(app).hostname;
    if (!/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/.test(cookieDomain) ||
        (host !== cookieDomain && !host.endsWith(`.${cookieDomain}`)) || !app.startsWith("https:")) {
      throw new Error("AUTH_COOKIE_DOMAIN_INVALID");
    }
  }
  const newsletter = newsletterAddress(env.HARVEST_NEWSLETTER_ORIGIN, app);
  return { app, marketing, legacy, cookieDomain, newsletter, trustedOrigins: [app] };
}

export function readWorkerSiteAddresses(env: SiteAddressEnvironment, stage: string) {
  const addresses = readSiteAddresses(env);
  const production = origin(env.HARVEST_PRODUCTION_ORIGIN);
  const local = stage === "local";
  if (!production.startsWith("https:") || loopbackHosts.includes(new URL(production).hostname) ||
      local !== loopbackHosts.includes(new URL(addresses.app).hostname) ||
      (stage === "production") !== (addresses.app === production)) throw new Error("WORKER_ORIGIN_INVALID");
  return addresses;
}

export const siteAddressScope = sharedScope<ReturnType<typeof readSiteAddresses>>("site-addresses");
export const siteAddresses = () => siteAddressScope.getStore() ?? readSiteAddresses();
export const appOrigin = () => siteAddresses().app;
export const appOriginIfConfigured = () => { try { return appOrigin(); } catch { return undefined; } };
export const marketingOrigin = () => siteAddresses().marketing;

export function newsletterOrigin() {
  const env = process.env as SiteAddressEnvironment;
  const scoped = siteAddressScope.getStore();
  if (scoped) return scoped.newsletter;
  const app = env.NODE_ENV === "production" ? appOrigin() : appOriginIfConfigured();
  return newsletterAddress(env.HARVEST_NEWSLETTER_ORIGIN, app);
}

export function appLink(path: string, query?: Record<string, string>) {
  const app = appOrigin();
  const url = new URL(path, app);
  if (!path.startsWith("/") || url.origin !== app) throw new Error("APP_LINK_PATH_INVALID");
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  return url.href;
}

const segment = encodeURIComponent;
export const signInLink = (returnTo?: string) => appLink("/sign-in", returnTo ? { next: returnTo } : undefined);
export const campaignInvitationLink = (token: string) => appLink(`/campaign-invitations/${segment(token)}`);
export const connectClaimLink = (token: string) => `${appLink("/connect/claim")}#${new URLSearchParams({ token })}`;
export const connectLinks = (link: Parameters<typeof publicLinkUrls>[1]) => publicLinkUrls(appOrigin(), link);
export const blogLink = (handle: string, slug?: string) => appLink(blogPath(handle, slug));
export const blogRssLink = (handle: string) => appLink(`${blogPath(handle)}/rss.xml`);
export const blogImageLink = (handle: string, id: string) => appLink(`${blogPath(handle)}/images/${segment(id)}`);
export const bioLink = (handle: string) => appLink(`/l/${segment(handle)}`);
export const giveLink = (slug: string) => appLink(`/give/${segment(slug)}`);
export const giveCoverLink = (slug: string) => appLink(`/give/${segment(slug)}/cover`);
export const communityLink = (slug: string) => appLink(`/communities/${segment(slug)}`);
export function communityUnsubscribeLinks(token: string, base = appOrigin()) {
  const form = new URL("/communities/unsubscribe", base);
  form.hash = new URLSearchParams({ token }).toString();
  const oneClick = new URL("/api/communities/unsubscribe", base);
  oneClick.searchParams.set("token", token);
  return { form: form.href, oneClick: oneClick.href };
}
export const communityPostLink = (slug: string, post: string) => appLink(`/communities/${segment(slug)}/posts/${segment(post)}`);
export const communityInviteLink = (slug: string, token: string) => appLink(`/communities/${segment(slug)}`, { invite: token });
export const eventCalendarLink = (tenant: string, event: string) =>
  appLink(`/api/workspaces/${segment(tenant)}/events/${segment(event)}/calendar`);
export const connectExportLink = (tenant: string, campaign: string, link: string, format?: string) =>
  appLink(`/api/workspaces/${segment(tenant)}/campaigns/${segment(campaign)}/connect/links/${segment(link)}/export`, format ? { format } : undefined);
export const newsletterSignupLink = (slug: string) => appLink(`/subscribe/${segment(slug)}`);
export const newsletterFileLink = (tenant: string, file: string) => new URL(publicFilePath(tenant, file), newsletterOrigin()).href;
export const newsletterUnavailableLink = () => new URL("/newsletter/link", appOriginIfConfigured() ?? newsletterOrigin()).href;
export function newsletterUnsubscribeLink(token: string) {
  const url = new URL("/api/newsletter/unsubscribe", newsletterOrigin());
  url.searchParams.set("token", token);
  return url;
}

const callbackPath = /^\/api\/(?:auth|integrations|newsletter\/callback|files\/transfer)(?:\/|$)/;
const oneClickPath = /^\/api\/(?:newsletter|communities)\/unsubscribe\/?$/;
export function acceptsLegacyCallback(request: Pick<Request, "url" | "method">, addresses: ReturnType<typeof readSiteAddresses>) {
  const url = new URL(request.url);
  return addresses.legacy.includes(url.origin) &&
    (callbackPath.test(url.pathname) || (request.method === "POST" && oneClickPath.test(url.pathname)));
}

export function legacyRedirect(request: Pick<Request, "url" | "method">, addresses?: ReturnType<typeof readSiteAddresses>) {
  if (request.method !== "GET" && request.method !== "HEAD") return;
  const original = new URL(request.url);
  // Auth callbacks and external integrations must keep their registered origin. Signed storage grants stay on their issuing host.
  if (callbackPath.test(original.pathname)) return;
  const configured = addresses ?? (process.env.LEGACY_ORIGINS?.trim() ? siteAddresses() : undefined);
  if (!configured) return;
  if (!configured.legacy.includes(original.origin)) return;
  const target = new URL(configured.app);
  target.pathname = original.pathname;
  target.search = original.search;
  return Response.redirect(target, 301);
}
