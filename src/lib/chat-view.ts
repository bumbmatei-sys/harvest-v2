import type { z } from "zod";
import type { channelInput, channelMutes } from "./chat";

export type ChatChannel = {
  id: string;
  name: string;
  emoji: string | null;
  description: string | null;
  position: number;
  archived?: boolean;
  minRole?: z.infer<typeof channelInput>["minRole"];
  posting: "members" | "hosts";
  accessMode: z.infer<typeof channelInput>["accessMode"];
  latestRev: string;
  mute: typeof channelMutes[number];
  unread: number;
  mentions: number;
};

export type ChatChannelSetting = z.infer<typeof channelInput> & { id: string; userIds: string[] };

export type ChatPerson = { id: string; name: string };
export type ChatMessage = {
  id: string;
  channelId: string;
  authorId: string | null;
  authorName: string | null;
  clientId: string;
  parentId: string | null;
  seq: string;
  rev: string;
  body: string | null;
  mentionIds: string[];
  mentions: ChatPerson[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  deletedKind: "author" | "host" | null;
  heldAt: string | null;
  pinnedAt: string | null;
  replyCount: number;
  reactions: { emoji: string; count: number; reactedByMe: boolean }[];
};

export type ChatPage = { events: ChatMessage[]; cursor: string | null; hasMore: boolean };
export type ChatAccess = { role: string; moderate: boolean; restore: boolean; muted: boolean };
export type ChatHeld = { id: string; channel_id: string; excerpt: string; held_at: string; held_reason: string; author_id: string | null };

export function mergeChatMessages(previous: ChatMessage[], events: ChatMessage[]) {
  const merged = new Map(previous.map(event => [event.id, event]));
  for (const event of events) {
    const known = merged.get(event.id);
    if (!known || BigInt(event.rev) >= BigInt(known.rev)) merged.set(event.id, event);
  }
  return [...merged.values()].sort((a, b) => BigInt(a.seq) < BigInt(b.seq) ? -1 : 1);
}
