import { randomUUID } from "node:crypto";
import { users } from "../../src/db/schema";
import type { Database } from "../../src/db/client";
import { createCommunity, getCommunity, listCategories, publishCommunity, updateCommunity } from "../../src/server/communities";
import { enterCommunity } from "../../src/server/community-joining";
import { reactChatMessage, saveChatSettings, sendChatMessage } from "../../src/server/community-chat";
import { dmStart, dmSend } from "../../src/server/community-dm";
import { saveComment, savePost, toggleLike } from "../../src/server/community-forum";
import { confirmCommunityUpload, createCommunityUpload } from "../../src/server/community-files";
import { createCatalogItem, enrolInCatalogItem, getCatalogContent, saveLessonNote, setCatalogState, setLessonComplete } from "../../src/server/free-catalog";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import type { StorageAdapter } from "../../src/server/storage/adapter";
import type { Pool } from "pg";

/** "Your data" fixture: two members (yd-me, yd-peer) with posts, replies, chat, DMs, likes, a reaction, a course with progress and a note, an event answer and an upload. */
export const ydPeople = { owner: "yd-owner", me: "yd-me", peer: "yd-peer", outsider: "yd-outsider" } as const;
export const ydSlug = "your-data-club";
export const ydCourse = "your-data-course";
export const ydStorage: StorageAdapter = {
  async presignUpload(key) { return { url: `https://storage.test/${key}`, method: "PUT", headers: {}, expiresIn: 60 }; },
  async inspect(_key, expected) { return { size: expected.size, mime: expected.mime, checksum: "b".repeat(64) }; },
  async presignDownload(key, _name, options) { return `https://storage.test/${key}?expires=${options?.expiresIn ?? 60}`; },
};
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
type Result = { outcome: string; [key: string]: unknown };

export async function seedYourData(db: Database, admin: Pool) {
  const { owner, me, peer, outsider } = ydPeople;
  await db.insert(users).values([owner, me, peer, outsider].map((id) => ({ id, name: `Name ${id}`, email: `${id}@example.invalid`, emailVerified: true })));
  const tenant = (await createWorkspace(db, owner, "Grace Example Ministry", "church")).tenantId;
  await putMember(db, owner, tenant, `${me}@example.invalid`, "viewer");
  const community = (await createCommunity(db, owner, tenant, { name: "Your data club", slug: ydSlug })).id;
  const { version } = await getCommunity(db, owner, tenant, community);
  const updated = await updateCommunity(db, owner, tenant, community, { version, visibility: "listed", allowOpen: true });
  await publishCommunity(db, owner, tenant, community, { version: updated.version, published: true });
  for (const user of [me, peer, outsider]) await enterCommunity(db, user, ydSlug, { rulesVersion: 0, adult: true });
  await saveChatSettings(db, owner, ydSlug, { chatEnabled: true, dmPolicy: "members" });
  const general = (await listCategories(db, owner, tenant, community))[0].id;
  const myPost = (await savePost(db, me, ydSlug, { categoryId: general, title: "My synthetic post", body: doc("Written by me") })).id!;
  const peerPost = (await savePost(db, peer, ydSlug, { categoryId: general, title: "Peer synthetic post", body: doc("Written by peer") })).id!;
  const myReply = (await saveComment(db, me, ydSlug, peerPost, { body: "My synthetic reply" })).id!;
  await saveComment(db, peer, ydSlug, myPost, { body: "Peer synthetic reply" });
  await toggleLike(db, me, ydSlug, { targetType: "post", targetId: peerPost });
  const channel = (await admin.query("select id from community_channels where community_id = $1", [community])).rows[0].id as string;
  const mine = (await sendChatMessage(db, me, ydSlug, channel, { client_id: randomUUID(), body: "My synthetic chat" })) as Result;
  const theirs = (await sendChatMessage(db, peer, ydSlug, channel, { client_id: randomUUID(), body: "Peer synthetic chat", mention_ids: [me] })) as Result;
  await reactChatMessage(db, me, ydSlug, (theirs.message as { id: string }).id, { emoji: "🙏" });
  const dm = (await dmStart(db, me, ydSlug, { targetUserId: peer, body: "My synthetic DM", client_id: randomUUID() })) as Result;
  const conversation = dm.conversationId as string;
  await dmSend(db, peer, ydSlug, conversation, { body: "Peer synthetic DM", client_id: randomUUID() });
  // A DM between two other people, which must never appear in yd-me's export.
  await dmStart(db, peer, ydSlug, { targetUserId: outsider, body: "Unrelated synthetic DM", client_id: randomUUID() });

  const item = await createCatalogItem(db, owner, tenant, { kind: "course", slug: ydCourse, title: "Synthetic course", visibility: "unlisted",
    sections: [{ title: "Week one", lessons: [{ title: "Lesson one", body: doc("One"), published: true }, { title: "Lesson two", body: doc("Two"), published: true }] }] });
  await setCatalogState(db, owner, tenant, item.id, { version: 1, state: "published" });
  for (const user of [me, peer]) await enrolInCatalogItem(db, user, ydCourse);
  const lessons = ((await getCatalogContent(db, me, ydCourse)) as unknown as { lessons: { id: string }[] }).lessons;
  await setLessonComplete(db, me, ydCourse, lessons[0].id, { completed: true });
  await saveLessonNote(db, me, ydCourse, lessons[0].id, { body: "My private synthetic note" });
  await setLessonComplete(db, peer, ydCourse, lessons[1].id, { completed: true });
  await saveLessonNote(db, peer, ydCourse, lessons[1].id, { body: "Peer private synthetic note" });

  const event = randomUUID();
  await admin.query("insert into events(tenant_id, id, title, time_zone, starts_at, ends_at, status) values ($1, $2, 'Synthetic gathering', 'UTC', now() + interval '1 day', now() + interval '2 days', 'published')", [tenant, event]);
  await admin.query("insert into event_rsvps(tenant_id, event_id, user_id, state, sources) values ($1, $2, $3, 'going', '{}'::jsonb), ($1, $2, $4, 'maybe', '{}'::jsonb)", [tenant, event, me, peer]);

  const upload = await createCommunityUpload(db, ydStorage, me, ydSlug, { kind: "attachment", name: "notes.pdf", mime: "application/pdf", size: 100, checksum: "b".repeat(64) });
  await confirmCommunityUpload(db, ydStorage, me, ydSlug, upload.file.id, { async scan() { return "clean"; } });
  await admin.query("update community_files set post_id = $1 where id = $2", [myPost, upload.file.id]);
  const draftUpload = await createCommunityUpload(db, ydStorage, me, ydSlug, { kind: "attachment", name: "draft.pdf", mime: "application/pdf", size: 100, checksum: "b".repeat(64) });
  return { tenant, community, channel, conversation, myPost, peerPost, myReply, myMessage: (mine.message as { id: string }).id, peerMessage: (theirs.message as { id: string }).id,
    lessons, event, file: upload.file.id, draftFile: draftUpload.file.id };
}
