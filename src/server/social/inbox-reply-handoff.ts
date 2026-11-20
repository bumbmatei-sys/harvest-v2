import type { InboxReplyMode } from "./inbox-contract";

/** The body is request-lifetime data. The durable reply record carries its keyed fingerprint only. */
export type TransientReply = {
  tenantId: string; id: string; itemId: string; mode: InboxReplyMode; targetRef: string | null; fileId: string | null; text: string;
};
export type ReplyHandoff = {
  offer: (payload: TransientReply) => boolean;
  available: () => string[];
  read: (key: string) => TransientReply | undefined;
  forget: (key: string) => void;
};
export const handoffKey = (tenantId: string, id: string) => `${tenantId}:${id}`;
export const fingerprintFields = (reply: TransientReply) =>
  [reply.tenantId, reply.id, reply.itemId, reply.mode, reply.targetRef, reply.fileId, reply.text];

export function createReplyHandoff(now: () => number = Date.now): ReplyHandoff {
  const entries = new Map<string, { payload: TransientReply; expires: number }>();
  const sweep = () => {
    const instant = now();
    for (const [key, entry] of entries) if (entry.expires <= instant) entries.delete(key);
  };
  return {
    offer(payload) {
      sweep();
      const key = handoffKey(payload.tenantId, payload.id);
      if (entries.has(key)) return true;
      if (entries.size >= 512) return false;
      entries.set(key, { payload: { ...payload }, expires: now() + 15 * 60_000 });
      return true;
    },
    available() { sweep(); return [...entries.keys()]; },
    read(key) { sweep(); return entries.get(key)?.payload; },
    forget(key) { entries.delete(key); },
  };
}
export const transientInboxReplies = createReplyHandoff();
