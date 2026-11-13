import { message, type MessageKey } from "../i18n/messages";
import type { Locale } from "../i18n/locale";
import { notificationHref, summaryKey, type NotificationKind } from "./notifications";
import { signUnsubscribe } from "./community-email-token";

// C15b: plain-text community email. Pure: the worker passes in what the database returned and gets text back.
// Member-written text is limited to display names and post titles, trimmed, stripped of control characters and of link-like text.
export const INSTANT_KINDS = ["application", "warning", "held_decision", "appeal_decision"] as const satisfies readonly NotificationKind[];
export const DIGEST_FREQUENCIES = ["daily", "weekly"] as const;
export const EMAIL_FREQUENCIES = ["off", "important", "daily", "weekly"] as const;
export type EmailFrequency = typeof EMAIL_FREQUENCIES[number];

export type EmailItem = { kind: NotificationKind; targetType: "post" | "comment" | "application" | "warning" | "appeal" | "community"; count: number;
  actorName: string | null; postTitle: string | null; postId: string | null; detail: Record<string, unknown> };
export type EmailJob = { id: string; kind: "instant" | "digest"; to: string; name: string; tenantId: string; communityId: string; recipientId: string;
  communityName: string; communitySlug: string; hasMembership: boolean; items: EmailItem[] };
export type RenderedEmail = { subject: string; text: string; headers: Record<string, string> };

const TITLE_MAX = 80;
// Plain-text mail is link-ified by mail clients, and this text arrives from the community's own sender. Member-written names
// and titles therefore must not carry something that looks like a link or an address (best effort, not a URL parser).
const LINKISH = new RegExp([
  String.raw`[a-z][a-z0-9+.-]*:\/\/\S*`,                      // scheme://anything
  String.raw`\b(?:mailto|tel|javascript|data):\S*`,              // other link schemes
  String.raw`www\.\S*`,                                          // www.anything
  String.raw`[^\s@]+@[^\s@]+\.[a-z]{2,}`,                       // addresses
  String.raw`\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|gov|io|co|me|app|dev|info|biz|xyz|ly|gg|tv|us|uk|ro|de|church|online|site|link|click|top|shop|live)\b(?:\/\S*)?`,
].join("|"), "gi");
/** One line, no control or bidirectional override characters, nothing link-like, at most 80 characters. */
export function safeTitle(value: string | null | undefined): string {
  const clean = (value ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(LINKISH, "[link removed]").replace(/\s+/g, " ").trim();
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1).trimEnd()}…` : clean;
}

const line = (item: EmailItem, locale: Locale): string => {
  const key = summaryKey({ kind: item.kind, count: item.count, detail: item.detail, targetType: item.targetType });
  const name = item.actorName ? safeTitle(item.actorName) : message("CommunityNotifications.someone", undefined, locale);
  return message(`CommunityNotifications.summary.${key}` as MessageKey, { name, others: Math.max(item.count - 1, 0), count: item.count }, locale);
};

export function renderEmail(job: EmailJob, opts: { origin: string; secret: string; now?: number; locale?: Locale }): RenderedEmail {
  const locale = opts.locale ?? "en", origin = opts.origin.replace(/\/$/, "");
  const community = safeTitle(job.communityName) || job.communitySlug;
  const lines = job.items.map((item) => {
    const where = new URL(notificationHref(job.communitySlug, item), origin).href;
    const title = safeTitle(item.postTitle);
    return [`• ${line(item, locale)}`, ...(title ? [`  ${title}`] : []), `  ${where}`].join("\n");
  });
  const subject = job.kind === "instant"
    ? message("CommunityEmail.instantSubject", { community, summary: line(job.items[0], locale) }, locale)
    : message("CommunityEmail.digestSubject", { community, count: job.items.length }, locale);
  const headers: Record<string, string> = {};
  const parts = [message("CommunityEmail.greeting", { name: safeTitle(job.name) || message("CommunityNotifications.someone", undefined, locale) }, locale), "",
    message(job.kind === "instant" ? "CommunityEmail.instantIntro" : "CommunityEmail.digestIntro", { community }, locale), "", ...lines, ""];
  if (job.hasMembership) {
    const link = new URL("/communities/unsubscribe", origin);
    link.hash = `token=${signUnsubscribe(opts.secret, { tenantId: job.tenantId, communityId: job.communityId, userId: job.recipientId }, opts.now)}`;
    // The one-click POST target carries the token in its query, as RFC 8058 requires a single URL.
    const post = new URL("/api/communities/unsubscribe", origin);
    post.searchParams.set("token", link.hash.slice("#token=".length));
    headers["List-Unsubscribe"] = `<${post.href}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    parts.push(message("CommunityEmail.unsubscribe", { community, url: link.href }, locale));
  } else parts.push(message("CommunityEmail.oneTime", undefined, locale));
  return { subject, text: `${parts.join("\n")}\n`, headers };
}
