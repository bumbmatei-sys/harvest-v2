import type { InboxKind, SocialPlatform } from "../../lib/social/platforms";
import type { Page } from "./types";

export type InboxAccount = { accountRef: string; platform: SocialPlatform };
export type InboxReference = { kind: InboxKind; ref: string };
export type InboxEntry = InboxReference & {
  accountRef: string;
  title: string | null;
  preview: string | null;
  activityAt: Date | null;
};
export type InboxAttachment = { type: string; url: string | null; name: string | null };
export type InboxMessage = {
  ref: string;
  direction: "incoming" | "outgoing" | "unknown";
  text: string | null;
  at: Date | null;
  attachments: InboxAttachment[];
  storyReply?: boolean;
  storyMention?: boolean;
  mentionsBot?: boolean;
  deleted?: boolean;
  canReply?: boolean;
  canPrivateReply?: boolean;
  deliveryStatus?: "sent" | "delivered" | "read" | "failed" | "played" | "deleted";
  replyTo?: string;
  story?: { ref: string; url: string | null };
};
export type InboxReplyMode = "message" | "comment" | "private" | "mention";
export type InboxReplyEligibility =
  | { allowed: true; expiresAt: Date | null; media: boolean; quote: boolean; humanAgent?: boolean; mediaRef?: string }
  | { allowed: false; reason: "unavailable" | "expired_window" | "permissions" | "unhealthy" | "target_unavailable" };
export type InboxListQuery = InboxAccount & { kind: InboxKind; cursor?: string; limit: number; search?: string; signal: AbortSignal };
export type InboxItemQuery = InboxAccount & InboxReference & { cursor?: string; limit: number; signal: AbortSignal };
export type InboxReplyQuery = InboxAccount & InboxReference & { mode: InboxReplyMode; targetRef: string | null; signal: AbortSignal };
export type InboxMedia = { type: "image" | "video" | "audio" | "file"; url: string };
export type InboxReplyRequest = Omit<InboxReplyQuery, "signal"> & {
  idempotencyKey: string; text: string; attachment?: InboxMedia; humanAgent?: boolean; mediaRef?: string;
};
export type InboxReadPage = Page<InboxMessage> & { title?: string | null };
