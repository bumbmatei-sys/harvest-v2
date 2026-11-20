import type { AutoDmEvent, AutoDmEvidence } from "./auto-dm-contract";
import type { InboxEntry, InboxItemQuery, InboxListQuery, InboxReadPage, InboxReplyEligibility, InboxReplyQuery, InboxReplyRequest } from "./inbox-contract";
import type {
  Comment, CommentReplyRequest, Conversation, InboundEvent, Message, Page, PageQuery, PostStatusResult, PublishRequest, PublishResult,
  SendMessageRequest, SendResult, SocialAccount, SocialAccountHealth, SocialCredential, SocialProviderId,
} from "./types";

export const providerErrorCodes = ["AUTH", "RATE_LIMITED", "INVALID_REQUEST", "NOT_FOUND", "CONFLICT", "UNAVAILABLE", "DISABLED", "MEDIA_EXPIRED", "EXPIRED", "UNSUPPORTED", "MEDIA_FETCH_FAILED"] as const;
export type ProviderErrorCode = typeof providerErrorCodes[number];
/**
 * The only error a provider may throw. The message is the fixed code: never a response body, token or request content.
 */
export class SocialProviderError extends Error {
  readonly retryable: boolean;
  constructor(public readonly code: ProviderErrorCode, public readonly retryAfterMs: number | null = null) {
    super(code);
    this.retryable = code === "RATE_LIMITED" || code === "UNAVAILABLE";
  }
}

/** Provider-neutral port. Implemented by the fake and by the (hard-disabled) vendor adapter. */
export interface SocialProvider {
  readonly id: SocialProviderId;
  /** Header carrying the delivery signature (lower case). */
  readonly signatureHeader: string;
  listAccounts(cred: SocialCredential): Promise<SocialAccount[]>;
  getAccountHealth(cred: SocialCredential, accountRef: string): Promise<SocialAccountHealth>;
  publishPost(cred: SocialCredential, request: PublishRequest): Promise<PublishResult>;
  cancelPost(cred: SocialCredential, postRef: string): Promise<void>;
  getPostStatus(cred: SocialCredential, postRef: string): Promise<PostStatusResult>;
  listConversations(cred: SocialCredential, query: PageQuery): Promise<Page<Conversation>>;
  listMessages(cred: SocialCredential, query: PageQuery & { conversationRef: string }): Promise<Page<Message>>;
  listComments(cred: SocialCredential, query: PageQuery & { postRef: string }): Promise<Page<Comment>>;
  listInbox(cred: SocialCredential, query: InboxListQuery): Promise<Page<InboxEntry>>;
  readInbox(cred: SocialCredential, query: InboxItemQuery): Promise<InboxReadPage>;
  inboxReplyEligibility(cred: SocialCredential, query: InboxReplyQuery): Promise<InboxReplyEligibility>;
  readAutoDmEvidence(cred: SocialCredential, query: AutoDmEvent): Promise<AutoDmEvidence | null>;
  /** Constant-time check of the delivery signature against every accepted secret. */
  verifyWebhook(rawBody: string, signature: string | null, secrets: readonly string[]): boolean;
  /** Returns null for a body that is not a recognisable event. Never returns message or comment text. */
  parseWebhookEvent(rawBody: string): InboundEvent | null;
}

/** The reviewed human-reply worker is the only domain consumer of this separate port. */
export interface SocialSender {
  sendMessage(cred: SocialCredential, request: SendMessageRequest): Promise<SendResult>;
  replyToComment(cred: SocialCredential, request: CommentReplyRequest): Promise<SendResult>;
  dispatchInboxReply(cred: SocialCredential, request: InboxReplyRequest): Promise<SendResult>;
  /** Absent proof must be inconclusive. An empty listing cannot prove non-delivery. */
  reconcileInboxReply(cred: SocialCredential, request: InboxReplyQuery & { idempotencyKey: string }): Promise<SendResult | null>;
}


export function isMediaFetchFailure(code: unknown) {
  return typeof code === "string" && ["media_url_unreachable", "media_download_failed", "media_fetch_failed", "media_url_expired"].includes(code.toLowerCase());
}
