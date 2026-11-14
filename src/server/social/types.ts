// Harvest-owned domain types for the social provider port. No adapter or vendor type may appear here.
export const socialProviders = ["zernio", "fake"] as const;
export type SocialProviderId = typeof socialProviders[number];
export const socialPlatforms = ["facebook", "instagram", "threads", "tiktok", "youtube"] as const;
export type SocialPlatform = typeof socialPlatforms[number];

/** Opaque provider credential. Held in memory only for the length of one call; stored only as a sealed envelope. */
export type SocialCredential = { readonly secret: string };

export type SocialAccount = { accountRef: string; platform: SocialPlatform; displayName: string | null };
export type SocialAccountHealth = { accountRef: string; health: "healthy" | "degraded" | "failing"; code: string | null };

export type MediaRef = { kind: "image" | "video"; url: string };
export type PublishRequest = {
  /** One per logical post. Sent on every retry so the provider can return the original. */
  idempotencyKey: string;
  accountRef: string;
  platform: SocialPlatform;
  content: string;
  media: readonly MediaRef[];
  /** Omitted means publish now. Harvest-owned scheduling always omits it. */
  scheduledFor?: Date;
};
export type ProviderPostStatus = "scheduled" | "publishing" | "published" | "partial" | "failed" | "cancelled";
export type PublishResult = { postRef: string; status: ProviderPostStatus };
export type PostStatusResult = { postRef: string; status: ProviderPostStatus; errorCategory: string | null };

export type Page<T> = { items: T[]; nextCursor: string | null };
export type PageQuery = { accountRef: string; cursor?: string; limit?: number };
// Inbox reads are live pass-through. Harvest stores none of this content.
export type Conversation = { conversationRef: string; accountRef: string; platform: SocialPlatform; participantName: string | null; lastMessagePreview: string | null; updatedAt: Date | null; unreadCount: number };
export type Message = { messageRef: string; conversationRef: string; direction: "incoming" | "outgoing"; text: string | null; sentAt: Date | null };
export type Comment = { commentRef: string; postRef: string; authorName: string | null; text: string | null; createdAt: Date | null };

export type SendMessageRequest = { idempotencyKey: string; accountRef: string; conversationRef: string; text: string };
export type CommentReplyRequest = { idempotencyKey: string; accountRef: string; postRef: string; commentRef: string; text: string };
export type SendResult = { ref: string };

/** Webhook event, reduced to what Harvest may keep. Message and comment text never appear here. */
export type InboundEventKind =
  | "post.scheduled" | "post.published" | "post.partial" | "post.failed" | "post.cancelled"
  | "account.connected" | "account.disconnected"
  | "message.received" | "message.sent" | "message.failed" | "comment.received" | "other";
export type InboundEvent = {
  eventId: string;
  kind: InboundEventKind;
  /** The provider's own event name, kept only for `other`, bounded. */
  rawType: string;
  accountRef: string | null;
  /** Post, conversation or comment reference the event is about. */
  subjectRef: string | null;
  platform: SocialPlatform | null;
  errorCategory: string | null;
  occurredAt: Date;
};
