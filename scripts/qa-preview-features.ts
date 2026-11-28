import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Database } from "../src/db/request";
import { emptyBioDefinition, type BioDefinition } from "../src/lib/link-in-bio";
import { getLanding, publicLanding, saveLanding, saveReview } from "../src/server/catalog-landing";
import { createCommunityUpload, confirmCommunityUpload } from "../src/server/community-files";
import { listPosts, savePost } from "../src/server/community-forum";
import { readCommunityPoints, writeCommunityPoints } from "../src/server/community-points";
import { listCategories } from "../src/server/communities";
import { connectExternalBlog, listExternalBlogs, refreshExternalBlogs } from "../src/server/external-blog";
import { createCatalogItem, enrolInCatalogItem, listCatalog, setCatalogState } from "../src/server/free-catalog";
import { getBioPage, saveBioDraft, transitionBioPage } from "../src/server/link-in-bio";
import { createBioPhotoUpload, confirmBioPhotoUpload, setBioPhoto } from "../src/server/link-in-bio-photo";
import { readMinistryProfile, saveMinistryProfile } from "../src/server/ministry-profile";
import { changePaymentAccount, paymentAccount } from "../src/server/ministry-payments/service";
import { changeVolunteerRoster, getVolunteerRoster } from "../src/server/volunteer-roster";
import { createGivingMethod, listGivingMethods } from "../src/server/ways-to-give";
import type { StorageAdapter, UploadGrant } from "../src/server/storage/adapter";
import { FakeProvider } from "../src/server/social/fake-provider";
import type { SocialDeps } from "../src/server/social/registry";

export type PreviewMedia = {
  storage: StorageAdapter;
  upload: (grant: UploadGrant, image: Buffer) => Promise<void>;
};
type Church = { tenant: string; owner: string; admin: string; member: string; viewer: string; community: string; slug: string };
const day = 86_400_000;
const dateIn = (days: number) => new Date(Date.now() + days * day).toISOString();
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const courseSlug = "qa-preview-prayer-practice";

export async function preparePreviewPoints(db: Database, church: Church) {
  const { owner, member, tenant, community } = church;
  const report = await readCommunityPoints(db, owner, tenant, community, "all");
  if (!report.settings.enabled) {
    await writeCommunityPoints(db, owner, tenant, community, { action: "settings",
      input: { enabled: true, post: 5, reply: 2, lesson: 10, event: 15, thresholds: [5, 15, 40] } });
  }
  const title = "QA Preview: share a weekly reflection";
  const challenge = report.challenges.find((row) => row.title === title) ??
    await writeCommunityPoints(db, owner, tenant, community, { action: "create",
      input: { title, goal: "post", target: 3, startsAt: dateIn(-1), endsAt: dateIn(30) } });
  const joined = (await readCommunityPoints(db, member, tenant, community, "all")).challenges.find((row) => row.id === challenge.id);
  if (!joined?.joinedAt && challenge.id && (!joined || Date.parse(joined.endsAt) > Date.now())) {
    await writeCommunityPoints(db, member, tenant, community, { action: "join", input: { challengeId: challenge.id } });
  }
}

async function seedVolunteerRoster(db: Database, { owner, member, admin, tenant }: Church) {
  const roster = await getVolunteerRoster(db, owner, tenant, { from: "2026-01-01", to: "2099-12-31" });
  const welcome = "QA Preview Welcome Team";
  const role = roster.roles.find((row) => row.name === welcome) ?? await changeVolunteerRoster(db, owner, tenant, {
    action: "role", name: welcome, department: "volunteers", description: "Greet guests and point families to check-in.",
  });
  const hospitality = "QA Preview Hospitality";
  if (!roster.roles.some((row) => row.name === hospitality)) {
    await changeVolunteerRoster(db, owner, tenant, { action: "role", name: hospitality, department: "volunteers" });
  }
  for (const [index, title] of ["QA Preview Sunday welcome", "QA Preview Midweek welcome"].entries()) {
    const slot = roster.slots.find((row) => row.title === title) ?? await changeVolunteerRoster(db, owner, tenant, {
      action: "slot", roleId: role.id, title, startsAt: dateIn(7 + index * 3), endsAt: dateIn(7.125 + index * 3), needed: 3, open: true,
    });
    if (index !== 0) continue;
    if (!roster.assignments.some((row) => row.slotId === slot.id && row.userId === member)) {
      await changeVolunteerRoster(db, member, tenant, { action: "signup", slotId: slot.id });
    }
    if (!roster.requests.some((row) => row.slotId === slot.id)) {
      await changeVolunteerRoster(db, member, tenant, { action: "swap", slotId: slot.id, replacementUserId: admin });
    }
  }
}

async function seedProfileAndGiving(db: Database, { owner, tenant }: Church) {
  const profile = await readMinistryProfile(db, owner, tenant);
  if ("version" in profile && profile.version === 0) {
    await saveMinistryProfile(db, owner, tenant, { version: 0, published: true, fields: {
      name: { value: "QA Preview Church", visibility: "public" },
      website: { value: "https://church.example.invalid", visibility: "public" },
      email: { value: "welcome@example.invalid", visibility: "public" },
    }, locations: [
      { name: "North Chapel", address1: "12 Example Lane", city: "Sampleton", country: "US", primary: true, visibility: "public" },
      { name: "Riverside Hall", address1: "42 Fictional Road", city: "Sampleton", country: "US", primary: false, visibility: "public" },
    ] });
  }
  const { account } = await paymentAccount(db, owner, tenant);
  if (account.status === "not_connected") {
    await changePaymentAccount(db, owner, tenant, { action: "connect", requestKey: "qa-preview-account", legalName: "QA Preview Church", country: "US", currency: "USD" });
  }
  if (account.status !== "disconnected") await changePaymentAccount(db, owner, tenant, { action: "disconnect" });
  const methods = await listGivingMethods(db, owner, tenant);
  if (!methods.some((row) => row.kind === "paypal")) {
    await createGivingMethod(db, owner, tenant, { kind: "paypal", label: "PayPal (synthetic)",
      url: "https://www.paypal.com/qa-preview-example-invalid-do-not-send", note: "Preview only", enabled: false });
  }
  if (!methods.some((row) => row.kind === "bank_transfer")) {
    await createGivingMethod(db, owner, tenant, { kind: "bank_transfer", label: "Bank transfer (synthetic)",
      iban: "DE36000000000000000000", accountHolder: "QA Preview Church", note: "Preview only", enabled: false });
  }
}

async function seedCourse(db: Database, { owner, member, viewer, tenant }: Church) {
  const existing = (await listCatalog(db, owner, tenant, null)).find((row) => row.slug === courseSlug);
  const item = existing ?? await createCatalogItem(db, owner, tenant, { kind: "course", slug: courseSlug, title: "A week of everyday prayer",
    summary: "Short reflections and practical ways to build a habit.", visibility: "listed",
    sections: [{ title: "Start a rhythm", lessons: [
      { title: "Make time to reflect", body: doc("Set aside five quiet minutes."), published: true },
      { title: "Keep a short journal", body: doc("Write down one thing you noticed."), published: true },
    ] }] });
  if (!existing || existing.state === "draft") await setCatalogState(db, owner, tenant, item.id, { version: item.version, state: "published" });
  const { landing } = await getLanding(db, owner, tenant, item.id);
  if (landing.version === 0) {
    for (const [user, rating, body] of [
      [member, 5, "I used the journal prompt all week."], [viewer, 4, "The short sessions made it easy to start."],
    ] as const) {
      if (!(await publicLanding(db, courseSlug, user))?.viewer.review) {
        await enrolInCatalogItem(db, user, courseSlug);
        await saveReview(db, user, courseSlug, { rating, body });
      }
    }
    await saveLanding(db, owner, tenant, item.id, { version: 0, subtitle: "Make space for prayer in ordinary days",
      body: doc("Two guided lessons for your next week."), included: ["Two guided lessons", "Daily reflection prompts"],
      aboutHeading: "Your hosts", aboutBody: "Created by the QA Preview Church team.", aboutPhotoId: null,
      faq: [{ question: "Can I start at any time?", answer: "Yes. Learn at your own pace." }],
      ctaQuote: "A small change I could keep.", ctaLabel: "Explore the course",
      price: { cents: 2900, currency: "USD" }, sale: { cents: 1900, startsAt: dateIn(-1), endsAt: dateIn(30) } });
  }
  return item.id;
}

const photos = [
  { name: "north-chapel.png", path: new URL("../public/icons/icon-512.png", import.meta.url) },
  { name: "riverside-hall.png", path: new URL("../public/icons/icon-192.png", import.meta.url) },
];
async function uploadPhoto(media: PreviewMedia, photo: typeof photos[number],
  create: (input: { kind: "cover"; name: string; size: number; mime: string; checksum: string }) => Promise<{ file: { id: string }; upload: UploadGrant }>,
  confirm: (id: string) => Promise<{ status: string }>) {
  const bytes = await readFile(photo.path);
  const { file, upload } = await create({ kind: "cover", name: photo.name, size: bytes.length, mime: "image/png",
    checksum: createHash("sha256").update(bytes).digest("hex") });
  await media.upload(upload, bytes);
  if ((await confirm(file.id)).status !== "ready") throw new Error("QA_SEED_PHOTO_NOT_READY");
  return file.id;
}

async function seedForumPost(db: Database, { owner, tenant, community, slug }: Church, courseId: string, media?: PreviewMedia) {
  const title = "Highlights from the neighborhood welcome day";
  const existing = (await listPosts(db, owner, slug)).posts.find((row) => row.title === title);
  if (existing && (!media || existing.postDetails?.photos.length)) return;
  const categoryId = existing?.categoryId ?? (await listCategories(db, owner, tenant, community))[0].id;
  const photoIds: string[] = [];
  if (media) {
    for (const photo of photos) photoIds.push(await uploadPhoto(media, photo,
      (input) => createCommunityUpload(db, media.storage, owner, slug, { ...input, kind: "attachment" }),
      (id) => confirmCommunityUpload(db, media.storage, owner, slug, id)));
  }
  await savePost(db, owner, slug, { categoryId, title, body: doc("Our welcome teams shared a meal and planned the next family gathering."),
    postDetails: { photoIds, location: "Riverside Hall, Sampleton", feeling: "grateful", linkedItems: [{ kind: "course", id: courseId }] } }, existing?.id);
}

async function seedBio(db: Database, { owner, tenant }: Church, media?: PreviewMedia) {
  const handle = "qa-preview-church";
  let page = await getBioPage(db, owner, tenant);
  const existingGallery = page.draft.blocks.find((block) => block.type === "gallery");
  if (page.handle === handle && existingGallery && (!media || (existingGallery?.fileIds.length && page.status === "published"))) return;
  const fileIds = existingGallery?.fileIds ?? [];
  if (media && !fileIds.length) {
    for (const photo of photos) fileIds.push(await uploadPhoto(media, photo,
      (input) => createBioPhotoUpload(db, owner, tenant, input, () => media.storage, "gallery"),
      (id) => confirmBioPhotoUpload(db, owner, tenant, id, () => media.storage, "gallery")));
  }
  if (media && !page.photoFileId) {
    const fileId = await uploadPhoto(media, photos[0],
      (input) => createBioPhotoUpload(db, owner, tenant, input, () => media.storage),
      (id) => confirmBioPhotoUpload(db, owner, tenant, id, () => media.storage));
    await setBioPhoto(db, owner, tenant, { version: page.version, fileId });
    page = await getBioPage(db, owner, tenant);
  }
  const definition: BioDefinition = { ...emptyBioDefinition("QA Preview Church"),
    subtitle: "A neighborhood ministry", bio: "Meet the team and see what is coming up.",
    tabs: [{ id: "home", label: "Welcome", hidden: false }, { id: "partnership", label: "Gallery", hidden: false }],
    blocks: [
      { type: "countdown", id: "qaspring", hidden: false, tab: "home", title: "Next welcome day", at: dateIn(18), url: "" },
      { type: "gallery", id: "qaphotos", hidden: false, tab: "partnership", title: "Around the ministry", fileIds },
    ] };
  page = await saveBioDraft(db, owner, tenant, { version: page.version, handle, definition });
  if (media) await transitionBioPage(db, owner, tenant, { version: page.version, action: "publish" });
}

async function seedExternalBlog(db: Database, { owner, tenant }: Church, credential: string) {
  const account = { platform: "wordpress", accountRef: "qa-preview-wordpress", displayName: "QA Preview Announcements" } as const;
  const fake = new FakeProvider({ validSecret: credential, accounts: [account] });
  fake.blogs.set(account.accountRef, [{ id: "announcements", title: "Community announcements" }]);
  const deps: SocialDeps = { enabled: true, provider: () => fake, now: () => new Date(),
    blogConnect: { providerId: "fake", credential: { secret: credential } } };
  const origin = "https://harvest.example.invalid";
  const current = await listExternalBlogs(db, owner, tenant, deps);
  if (current.destinations.some((row) => row.title === "Community announcements")) return;
  let connectionId = current.accounts.find((row) => row.label === account.displayName)?.id;
  if (!connectionId) {
    const start = await connectExternalBlog(db, owner, tenant, { action: "start", platform: account.platform }, deps, origin);
    if (!("attempt" in start) || !start.url || !start.attempt) throw new Error("QA_SEED_FAKE_BLOG_START");
    fake.blogConnectProfiles.set(new URL(start.url).pathname.slice(1), account);
    const result = await connectExternalBlog(db, owner, tenant, { action: "finish", attempt: start.attempt }, deps, origin);
    if ("connectionId" in result) connectionId = result.connectionId;
  }
  if (!connectionId) throw new Error("QA_SEED_FAKE_BLOG_FINISH");
  await refreshExternalBlogs(db, owner, tenant, connectionId, deps);
}

export async function seedChurchFeatures(db: Database, church: Church, options: { media?: PreviewMedia; socialCredential?: string }) {
  await seedVolunteerRoster(db, church);
  await seedProfileAndGiving(db, church);
  const courseId = await seedCourse(db, church);
  await seedForumPost(db, church, courseId, options.media);
  await seedBio(db, church, options.media);
  if (options.socialCredential) await seedExternalBlog(db, church, options.socialCredential);
}
