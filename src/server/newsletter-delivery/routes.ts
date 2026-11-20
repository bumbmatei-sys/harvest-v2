import { z } from "zod";
import { newsletterQuery, newsletterRoute } from "../newsletter-route";
import { newsletterAnalytics } from "./analytics";
import { cancelNewsletterCampaign, createNewsletterSender, disableNewsletterSender, getNewsletterCampaign,
  listNewsletterDeliveryConfig, previewNewsletterCampaign, reviewNewsletterCampaign, saveNewsletterCampaign,
  saveNewsletterTemplate, testNewsletterCampaign } from "./campaigns";
import { newsletterMissing } from "../newsletter-access";
import { isFakeNewsletter, NEWSLETTER_INTEGRATION_ENABLED, type FakeNewsletterRuntime } from "./registry";

type Workspace = { tenantId: string };
type Campaign = Workspace & { campaignId: string };
type Context<P> = { params: Promise<P> };

function deliveryRoute<P>(action: Parameters<typeof newsletterRoute<P>>[0], write: boolean, testRuntime?: FakeNewsletterRuntime) {
  const handle = newsletterRoute(action, write);
  return (request: Request, context: Context<P>) => {
    if (!NEWSLETTER_INTEGRATION_ENABLED && !(testRuntime && isFakeNewsletter(testRuntime))) return Promise.resolve(new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } }));
    return handle(request, context);
  };
}

export function newsletterCollection(kind: "campaigns" | "senders" | "templates") {
  return deliveryRoute<Workspace>(({ db, user, params, request }) =>
    listNewsletterDeliveryConfig(db, user, params.tenantId, kind, newsletterQuery(request)), false);
}

export const createCampaignRoute = deliveryRoute<Workspace>(({ db, user, params, body }) =>
  saveNewsletterCampaign(db, user, params.tenantId, body), true);
export const createSenderRoute = deliveryRoute<Workspace>(({ db, user, params, body }) =>
  createNewsletterSender(db, user, params.tenantId, body), true);
export const createTemplateRoute = deliveryRoute<Workspace>(({ db, user, params, body }) =>
  saveNewsletterTemplate(db, user, params.tenantId, body), true);
export const updateTemplateRoute = deliveryRoute<Workspace & { templateId: string }>(({ db, user, params, body }) =>
  saveNewsletterTemplate(db, user, params.tenantId, body, params.templateId), true);

export const disableSenderRoute = deliveryRoute<Workspace & { senderId: string }>(({ db, user, params, body }) => {
  z.strictObject({}).parse(body);
  return disableNewsletterSender(db, user, params.tenantId, params.senderId);
}, true);

export const getCampaignRoute = deliveryRoute<Campaign>(({ db, user, params }) =>
  getNewsletterCampaign(db, user, params.tenantId, params.campaignId), false);
export const saveCampaignRoute = deliveryRoute<Campaign>(({ db, user, params, body }) =>
  saveNewsletterCampaign(db, user, params.tenantId, body, params.campaignId), true);
export const previewCampaignRoute = deliveryRoute<Campaign>(({ db, user, params }) =>
  previewNewsletterCampaign(db, user, params.tenantId, params.campaignId), false);
export const reviewCampaignRoute = deliveryRoute<Campaign>(({ db, user, params, body }) =>
  reviewNewsletterCampaign(db, user, params.tenantId, params.campaignId, body), true);
export const cancelCampaignRoute = deliveryRoute<Campaign>(({ db, user, params, body }) =>
  cancelNewsletterCampaign(db, user, params.tenantId, params.campaignId, body), true);
export const campaignAnalyticsRoute = deliveryRoute<Campaign>(({ db, user, params, request }) =>
  newsletterAnalytics(db, user, params.tenantId, { campaignId: params.campaignId }, newsletterQuery(request)), false);
export const listAnalyticsRoute = deliveryRoute<Workspace & { listId: string }>(({ db, user, params, request }) =>
  newsletterAnalytics(db, user, params.tenantId, { listId: params.listId }, newsletterQuery(request)), false);

export function newsletterTestSendRoute(injected?: FakeNewsletterRuntime) {
  return deliveryRoute<Campaign>(({ db, user, params, body }) => {
    z.strictObject({}).parse(body);
    if (!injected) throw newsletterMissing();
    return testNewsletterCampaign(db, user, params.tenantId, params.campaignId, injected);
  }, true, injected);
}
