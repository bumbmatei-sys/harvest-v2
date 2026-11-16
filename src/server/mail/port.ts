import type { AccountProvider, Credential, Page, Query } from "../office-provider/types";
export type MailThread = { ref: string; subject: string };
export type MailMessage = { ref: string; threadRef: string; subject: string; body: string; from: string; to: string[]; labelRefs: string[] };
export type MailDraft = { ref: string; to: string[]; subject: string; body: string };
export type MailLabel = { ref: string; name: string };
export type MailWrite = { accountRef: string; idempotencyKey: string; to: string[]; subject: string; body: string; scheduledFor?: string };
export type SendCap = { dailyLimit: number; used: number; remaining: number; resetsAt: string };
export interface MailProvider extends AccountProvider {
  listThreads(c: Credential, q: Query): Promise<Page<MailThread>>;
  listMessages(c: Credential, q: Query & { threadRef: string }): Promise<Page<MailMessage>>;
  send(c: Credential, input: MailWrite): Promise<{ ref: string }>;
  reply(c: Credential, input: MailWrite & { messageRef: string }): Promise<{ ref: string }>;
  forward(c: Credential, input: MailWrite & { messageRef: string }): Promise<{ ref: string }>;
  saveDraft(c: Credential, input: Omit<MailWrite, "idempotencyKey"> & { draftRef?: string }): Promise<MailDraft>;
  deleteDraft(c: Credential, accountRef: string, draftRef: string): Promise<void>;
  listDrafts(c: Credential, q: Query): Promise<Page<MailDraft>>;
  listLabels(c: Credential, accountRef: string): Promise<MailLabel[]>;
  setLabels(c: Credential, accountRef: string, messageRef: string, labelRefs: string[]): Promise<void>;
  getSendCap(c: Credential, accountRef: string): Promise<SendCap>;
}
