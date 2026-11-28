import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { Database } from "../src/db/request";
import { defaultBrand } from "../src/lib/email/blocks";
import { templateDocument } from "../src/lib/email/templates";
import { dispatchCampaign, getCampaign, listCampaigns, reviewCampaign, writeCampaign } from "../src/server/newsletter-campaigns/campaigns";
import { FakeNewsletterProvider } from "../src/server/newsletter-campaigns/fake-provider";
import { createIdentity, updateIdentity } from "../src/server/newsletter-campaigns/identities";
import { saveMailingAddress, senderSetup, verifyDomain } from "../src/server/newsletter-campaigns/sender-setup";
import { newsletterSuppressionKeys } from "../src/server/newsletter-campaigns/suppression-keys";
import { runNewsletterWorker } from "../src/server/newsletter-campaigns/worker";
import { requireWorkerRole } from "../src/server/worker-role";

async function seedIdentities(db: Database, owner: string, tenant: string, provider: FakeNewsletterProvider) {
  const state = await senderSetup(db, owner, tenant);
  if (!state.mailingAddress.address) {
    await saveMailingAddress(db, owner, tenant, { address: "12 Example Lane, Sampleton", ...(state.mailingAddress.version ? { version: state.mailingAddress.version } : {}) });
  }
  const identities = [];
  for (const purpose of ["sender", "reply-to"] as const) {
    const address = `qa-newsletter-${purpose}@example.invalid`;
    const found = state.identities.find((row) => row.address === address && row.purpose === purpose);
    if (found?.ownershipVerified) {
      identities.push(found.id);
      continue;
    }
    let code: string | undefined;
    const sink = { async confirmMailbox(mail: { text: string }) { code = mail.text.split(" ").at(-1); } };
    const update = found
      ? await updateIdentity(db, owner, tenant, found.id, { action: "request-code", version: found.version }, sink)
      : await createIdentity(db, owner, tenant, { address, purpose }, sink);
    if (!code) throw new Error("QA_SEED_MAILBOX_CONFIRMATION");
    const confirmed = await updateIdentity(db, owner, tenant, update.identity.id, { action: "confirm", code, version: update.identity.version });
    identities.push(confirmed.identity.id);
  }
  const domain = (await senderSetup(db, owner, tenant)).domains.find((row) => row.domain === "example.invalid");
  if (!domain) throw new Error("QA_SEED_NEWSLETTER_DOMAIN");
  if (domain.status !== "verified") await verifyDomain(db, owner, tenant, domain.id, provider);
  return { senderId: identities[0], replyToId: identities[1] };
}

export async function seedPreviewNewsletterCampaigns(db: Database, owner: string, tenant: string, listId: string, worker?: Pool) {
  const drafts = [
    { name: "QA Preview July newsletter", subject: "July at the neighborhood chapel", preheader: "Welcome teams, a new course and a summer gathering." },
    { name: "QA Preview volunteer update", subject: "A note for our welcome teams", preheader: "Sunday and midweek volunteer shifts are open." },
  ];
  const existing = new Map<string, Awaited<ReturnType<typeof listCampaigns>>["items"][number]>();
  let after: string | null = null;
  do {
    const page = await listCampaigns(db, owner, tenant, { ...(after ? { after } : {}), limit: 100 });
    for (const campaign of page.items) existing.set(campaign.name, campaign);
    after = page.nextCursor;
  } while (after);
  const provider = new FakeNewsletterProvider();
  if (worker) await requireWorkerRole(worker);
  for (const [index, draft] of drafts.entries()) {
    const prior = existing.get(draft.name);
    if (prior?.state === "sent") continue;
    const input = { ...draft, selection: { listIds: [listId], segmentIds: [] },
      content: templateDocument("welcome", { ...defaultBrand, address: "12 Example Lane, Sampleton" }) };
    // The volunteer update remains editable. Populate actual delivery stats on the other campaign.
    if (!worker || index !== 0) {
      if (!prior) await writeCampaign(db, owner, tenant, input);
      continue;
    }
    const suppressionKeys = newsletterSuppressionKeys();
    let campaignId = prior?.id;
    if (!prior || ["draft", "reviewed"].includes(prior.state)) {
      const identities = await seedIdentities(db, owner, tenant, provider);
      // The current synthetic delivery worker's asset checks accept the original rich-text block array.
      const content = [{ type: "richText", doc: { type: "doc", content: [
        { type: "paragraph", content: [{ type: "text", text: "Welcome to the July update from QA Preview Church." }] },
      ] } }];
      const campaign = await writeCampaign(db, owner, tenant, { ...input, ...identities, content, ...(prior ? { version: prior.version } : {}) }, prior?.id);
      const dispatch = { mode: "now" } as const;
      const review = await reviewCampaign(db, owner, tenant, campaign.id, { version: campaign.version, dispatch });
      await dispatchCampaign(db, owner, tenant, campaign.id, { token: review.token, version: review.version, dispatch }, "now");
      campaignId = campaign.id;
    }
    if (!campaignId) throw new Error("QA_SEED_NEWSLETTER_CAMPAIGN");
    const run = await runNewsletterWorker(worker, {
      NODE_ENV: "test", HARVEST_NEWSLETTER_WORKER_ENABLED: "1",
      HARVEST_NEWSLETTER_TOKEN_KEY: randomBytes(32).toString("hex"), HARVEST_NEWSLETTER_SUPPRESSION_KEYS: suppressionKeys,
    }, provider, { campaignId });
    if (!run || run.errors || (await getCampaign(db, owner, tenant, campaignId)).state !== "sent") {
      throw new Error("QA_SEED_NEWSLETTER_DELIVERY_FAILED");
    }
  }
}
