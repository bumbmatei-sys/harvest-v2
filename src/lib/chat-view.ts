import type { z } from "zod";
import { chatTokens, type channelInput, type channelMutes } from "./chat";

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

const linkPattern = /https?:\/\/[^\s<>]+/g;
/** Distinct web links in the loaded messages (not deleted or held), newest first. The server cannot list link messages. */
export function channelLinks(messages: readonly ChatMessage[], max = 50) {
  const seen = new Set<string>();
  for (const message of [...messages].sort((a, b) => BigInt(a.seq) < BigInt(b.seq) ? 1 : -1)) {
    if (message.deletedAt || message.heldAt || !message.body) continue;
    for (const match of message.body.match(linkPattern) ?? []) {
      const link = match.replace(/[.,;:!?)\]]+$/, "");
      if (link.length > 2 && !seen.has(link) && seen.size < max) seen.add(link);
    }
  }
  return [...seen];
}

/** A message body for a list: mention tokens become names, and a token the server did not validate stays out of sight. */
export function plainChatBody(message: ChatMessage) {
  return chatTokens(message.body ?? "", message.mentionIds).map(part => {
    if (part.type !== "mention") return part.text;
    const person = message.mentions.find(member => member.id === part.id);
    return person ? `@${person.name}` : "";
  }).join("").replace(/<@[^<>\s]+>/g, "");
}

export function chatUnreadTotal(channels: ChatChannel[]) {
  return channels.reduce((total, channel) => total + (channel.mute === "none" ? channel.unread : channel.mute === "mentions_only" ? channel.mentions : 0), 0);
}
