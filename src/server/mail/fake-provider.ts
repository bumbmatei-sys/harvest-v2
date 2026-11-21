import { FakeStore } from "../office-provider/fake-store";
import { OfficeProviderError, type Credential, type Query } from "../office-provider/types";
import type { MailProvider, MailMessage, MailDraft, MailWrite } from "./port";
export class FakeMailProvider extends FakeStore implements MailProvider {
  private messages = new Map<string, MailMessage>();
  private drafts = new Map<string, MailDraft>();
  private usage = new Map<string, number>();
  constructor(accounts?: readonly string[], private readonly dailyLimit = 100, private readonly now = () => new Date("2026-11-16T12:00:00Z")) { super(accounts); }
  async listThreads(c: Credential, q: Query & { folderRef?: string }) { this.authorize(c, q.accountRef); const threads = new Map<string, { ref: string; subject: string }>(); for (const m of this.entries(this.messages, q.accountRef)) if ((!q.folderRef || m.labelRefs.includes(q.folderRef)) && (!q.search || `${m.subject} ${m.body}`.toLowerCase().includes(q.search.toLowerCase()))) threads.set(m.threadRef, { ref: m.threadRef, subject: m.subject }); return this.page([...threads.values()], q); }
  async listMessages(c: Credential, q: Query & { threadRef: string }) { this.authorize(c, q.accountRef); return this.page(this.entries(this.messages, q.accountRef).filter(m => m.threadRef === q.threadRef && (!q.search || `${m.subject} ${m.body}`.includes(q.search))), q); }
  findMessage(c: Credential, accountRef: string, messageRef: string) {
    this.authorize(c, accountRef);
    return structuredClone(this.get(this.messages, accountRef, messageRef));
  }
  seedMessage(accountRef: string, message: MailMessage) {
    this.messages.set(this.key(accountRef, message.ref), structuredClone(message));
  }
  private entries<T>(map: Map<string, T>, account: string) { return [...map].filter(([key]) => (JSON.parse(key) as string[])[0] === account).map(([, v]) => v); }
  private async write(c: Credential, input: MailWrite, method: string, messageRef?: string) {
    this.authorize(c, input.accountRef);
    const source = messageRef ? this.get(this.messages, input.accountRef, messageRef) : undefined;
    return this.once(input.accountRef, method, input.idempotencyKey, input, () => {
    if (!input.to.length || !input.subject || !input.body || input.scheduledFor && (!Number.isFinite(Date.parse(input.scheduledFor)) || Date.parse(input.scheduledFor) <= this.now().getTime())) throw new OfficeProviderError("INVALID_REQUEST");

      const day = this.now().toISOString().slice(0, 10), key = this.key(input.accountRef, day), used = this.usage.get(key) ?? 0;
      if (used >= this.dailyLimit) throw new OfficeProviderError("RATE_LIMITED");
      this.usage.set(key, used + 1);
      const ref = this.id("message");
      this.messages.set(this.key(input.accountRef, ref), { ref, threadRef: method === "reply" ? source!.threadRef : this.id("thread"), subject: input.subject, body: input.body, from: input.accountRef, to: [...input.to], labelRefs: [] });
      // Scheduled sends reserve quota but never deliver; the fake has no worker or network.
      return { ref };
    });
  }
  send(c: Credential, input: MailWrite) { return this.write(c, input, "send"); }
  reply(c: Credential, input: MailWrite & { messageRef: string }) { return this.write(c, input, "reply", input.messageRef); }
  forward(c: Credential, input: MailWrite & { messageRef: string }) { return this.write(c, input, "forward", input.messageRef); }
  async saveDraft(c: Credential, input: Omit<MailWrite, "idempotencyKey"> & { draftRef?: string }) { this.authorize(c, input.accountRef); if (input.draftRef) this.get(this.drafts, input.accountRef, input.draftRef); const draft = { ref: input.draftRef ?? this.id("draft"), to: [...input.to], subject: input.subject, body: input.body }; this.drafts.set(this.key(input.accountRef, draft.ref), draft); return structuredClone(draft); }
  async deleteDraft(c: Credential, accountRef: string, draftRef: string) { this.authorize(c, accountRef); this.get(this.drafts, accountRef, draftRef); this.drafts.delete(this.key(accountRef, draftRef)); }
  async listDrafts(c: Credential, q: Query) { this.authorize(c, q.accountRef); return this.page(this.entries(this.drafts, q.accountRef).filter(d => !q.search || `${d.subject} ${d.body}`.includes(q.search)), q); }
  async listLabels(c: Credential, accountRef: string) { this.authorize(c, accountRef); return [{ ref: "inbox", name: "Inbox" }, { ref: "archive", name: "Archive" }]; }
  async setLabels(c: Credential, accountRef: string, messageRef: string, labelRefs: string[]) { this.authorize(c, accountRef); if (labelRefs.some(l => !["inbox", "archive"].includes(l))) throw new OfficeProviderError("INVALID_REQUEST"); this.get(this.messages, accountRef, messageRef).labelRefs = [...labelRefs]; }
  async getSendCap(c: Credential, accountRef: string) { this.authorize(c, accountRef); const day = this.now().toISOString().slice(0, 10), used = this.usage.get(this.key(accountRef, day)) ?? 0; return { dailyLimit: this.dailyLimit, used, remaining: Math.max(0, this.dailyLimit - used), resetsAt: new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString() }; }
}
