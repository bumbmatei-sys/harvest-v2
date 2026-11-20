import type { FakeProvider } from "./fake-provider";
import type { InboxEntry, InboxMessage } from "./inbox-contract";
import type { Conversation, Message } from "./types";
import type { SocialPlatform } from "../../lib/social/platforms";

// Synthetic inbox content for the non-production fake provider only (see social-publish-gate.ts). Invented people and sentences; nothing here is real
// data, and it is never reachable once the gate is closed. Times are relative to the moment the server process started, so the screens always show
// "a few minutes ago" style times.
const minutes = (start: number, n: number) => new Date(start - n * 60_000);
const account = (platform: SocialPlatform) => `test-${platform}`;

export function seedSyntheticInbox(fake: FakeProvider, start = Date.now()) {
  const conversations: Conversation[] = [], messages: Message[] = [], entries: InboxEntry[] = [];
  const dm = (platform: SocialPlatform, ref: string, name: string, ago: number, lines: [("incoming" | "outgoing"), string][]) => {
    lines.forEach(([direction, text], index) => messages.push({ messageRef: `${ref}-m${index + 1}`, conversationRef: ref, direction, text, sentAt: minutes(start, ago + (lines.length - index - 1) * 3) }));
    conversations.push({ conversationRef: ref, accountRef: account(platform), platform, participantName: name, lastMessagePreview: lines.at(-1)![1], updatedAt: minutes(start, ago), unreadCount: 0 });
  };
  const thread = (platform: SocialPlatform, kind: "comment" | "mention" | "story", ref: string, title: string, preview: string, ago: number, items: InboxMessage[]) => {
    entries.push({ kind, ref, accountRef: account(platform), title, preview, activityAt: minutes(start, ago) });
    fake.inboxMessages.set(JSON.stringify([account(platform), kind, ref]), items);
  };

  dm("instagram", "ig-dm-maria", "Maria Santos", 4, [["incoming", "Hi! Is the Wednesday prayer night open to visitors?"], ["outgoing", "Yes, everyone is welcome. Doors open at 6:30."], ["incoming", "Wonderful, can I bring my two kids?"]]);
  dm("instagram", "ig-dm-daniel", "Daniel Okafor", 35, [["incoming", "Thank you for the service this morning, it meant a lot."]]);
  dm("instagram", "ig-dm-priya", "Priya Nair", 190, [["incoming", "Where do I sign up for the small groups?"], ["outgoing", "There is a sign-up table in the lobby, or we can add you here."]]);
  for (let n = 1; n <= 12; n++) dm("instagram", `ig-dm-visitor-${n}`, `Visitor ${String(n).padStart(2, "0")}`, 300 + n * 17, [["incoming", `Question number ${n} about the youth schedule.`]]);
  dm("facebook", "fb-dm-grace", "Grace Lee", 12, [["incoming", "Could someone call me about the food pantry hours?"]]);
  dm("twitter", "x-dm-samuel", "Samuel Reed", 70, [["incoming", "Do you livestream the evening service?"], ["outgoing", "We do, every Sunday at 6 pm."], ["incoming", "Great, thanks. Is there a link?"]]);
  dm("bluesky", "bsky-dm-ana", "Ana Pereira", 500, [["incoming", "Hello from Lisbon, I will visit in March."]]);
  dm("telegram", "tg-dm-prayer", "Prayer team chat", 22, [["incoming", "Can we add the Tuesday request to the list?"]]);
  fake.replyEligibility.set(JSON.stringify([account("twitter"), "dm", "x-dm-samuel"]), { allowed: false, reason: "expired_window" });

  const comment = (ref: string, name: string, text: string, ago: number, over: Partial<InboxMessage> = {}): InboxMessage =>
    ({ ref, direction: "incoming", text, at: minutes(start, ago), attachments: [], canReply: true, canPrivateReply: false, ...over });
  thread("instagram", "comment", "ig-comment-reel", "Sunday worship reel", "This song is beautiful", 9, [
    comment("ig-c1", "Lena Fox", "This song is beautiful, what is it called?", 9, { canPrivateReply: true }),
    comment("ig-c2", "Marcus Bell", "Praying for everyone who was there.", 14),
    comment("ig-c3", "Tara Quinn", "Can I share this with my group?", 26, { canReply: false }),
    { ref: "ig-c4", direction: "incoming", text: null, at: minutes(start, 40), attachments: [], deleted: true, canReply: false },
  ]);
  thread("instagram", "mention", "ig-mention-youth", "Mention by a youth group account", "Tagged in a photo", 55, [
    { ref: "ig-mn1", direction: "incoming", text: "Great night with @grace_community youth, see you next week.", at: minutes(start, 55), attachments: [{ type: "image", url: null, name: "youth-night.jpg" }], canReply: true },
  ]);
  thread("instagram", "story", "ig-story-reply", "Reply to your story", "Love this verse", 130, [
    { ref: "ig-st1", direction: "incoming", text: "Love this verse, needed it today.", at: minutes(start, 130), attachments: [], storyReply: true, story: { ref: "story-1", url: null } },
  ]);
  thread("facebook", "comment", "fb-comment-photos", "Youth night photos", "Such a joyful evening", 18, [
    comment("fb-c1", "Ruth Adler", "Such a joyful evening, thank you to the volunteers.", 18, { canPrivateReply: true }),
    comment("fb-c2", "Ben Okoro", "Will there be another one next month?", 31),
  ]);
  thread("twitter", "comment", "x-reply-thread", "Replies to the Sunday post", "Blessed morning", 95, [comment("x-c1", "Jo Marsh", "Blessed morning, thank you.", 95)]);
  thread("bluesky", "comment", "bsky-reply-thread", "Replies to the weekly note", "Thank you", 610, [comment("bsky-c1", "Eli Hart", "Thank you for sharing.", 610)]);

  fake.conversations.push(...conversations);
  fake.messages.push(...messages);
  fake.inboxEntries.push(...entries);
}
