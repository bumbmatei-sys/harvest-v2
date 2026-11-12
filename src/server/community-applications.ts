import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { auditLogs, communities, communityApplications, communityMemberships, entitlements, users } from "../db/schema";
import { message } from "../i18n/messages";
import { notifyApplicant } from "./community-notifications";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

// PR 4a (C07): the community's owners and admins review applications. Staff path only (withTenant +
// communities:manage); applicants act through the definers in migration 0037 and never see reviewer notes.
const listInput = z.object({ status: z.enum(["open", "all"]).default("open") }).strict();
const note = z.string().trim().min(1).max(1000);
const decision = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), note: note.optional() }).strict(),
  z.object({ action: z.literal("decline"), note: note.optional() }).strict(),
  z.object({ action: z.literal("request_info"), message: z.string().trim().min(1).max(500), note: note.optional() }).strict(),
  z.object({ action: z.literal("note"), note: note.nullable() }).strict(),
]);
const open = ["pending", "info_requested"] as const;

export function listApplications(db: Database, userId: string, workspace: string, communityId: string, raw: unknown = {}) {
  const { status } = listInput.parse(raw), id = z.uuid().parse(communityId);
  return withTenant(db, userId, z.uuid().parse(workspace), "communities:manage", async (tx, tenantId) => {
    const [community] = await tx.select({ id: communities.id, joinQuestions: communities.joinQuestions, questionsVersion: communities.questionsVersion })
      .from(communities).where(and(eq(communities.tenantId, tenantId), eq(communities.id, id)));
    if (!community) throw new AccessError(404, message("Errors.communityNotFound"));
    // Name only from users: never contact details (ADR 0013 §4a).
    const rows = await tx.select({ id: communityApplications.id, name: users.name, status: communityApplications.status, answers: communityApplications.answers,
      questionsVersion: communityApplications.questionsVersion, infoRequest: communityApplications.infoRequest, reviewerNote: communityApplications.reviewerNote,
      createdAt: communityApplications.createdAt, updatedAt: communityApplications.updatedAt })
      .from(communityApplications).innerJoin(users, eq(users.id, communityApplications.userId))
      .where(and(eq(communityApplications.tenantId, tenantId), eq(communityApplications.communityId, id),
        status === "open" ? inArray(communityApplications.status, [...open]) : undefined))
      .orderBy(asc(communityApplications.createdAt)).limit(500);
    return { questions: community.joinQuestions, questionsVersion: community.questionsVersion, applications: rows };
  });
}

/** Approve (membership + application grant), decline, ask for more information, or keep a private note. */
export async function decideApplication(db: Database, userId: string, workspace: string, communityId: string, applicationId: string, raw: unknown) {
  const input = decision.parse(raw), id = z.uuid().parse(communityId), appId = z.uuid().parse(applicationId);
  return withTenant(db, userId, z.uuid().parse(workspace), "communities:manage", async (tx, tenantId) => {
    const [application] = await tx.select().from(communityApplications)
      .where(and(eq(communityApplications.tenantId, tenantId), eq(communityApplications.communityId, id), eq(communityApplications.id, appId))).for("update");
    if (!application) throw new AccessError(404, message("Errors.applicationNotFound"));
    const now = new Date(), key = eq(communityApplications.id, appId);
    if (input.action === "note") {
      await tx.update(communityApplications).set({ reviewerNote: input.note, updatedAt: now }).where(key);
      return { status: application.status };
    }
    if (!(open as readonly string[]).includes(application.status)) throw new AccessError(409, message("Errors.applicationChanged"));
    const noteChange = input.note !== undefined ? { reviewerNote: input.note } : {};
    if (input.action === "request_info") {
      await tx.update(communityApplications).set({ status: "info_requested", infoRequest: input.message, updatedAt: now, ...noteChange }).where(key);
      await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "community.application_request_info", targetId: id, metadata: { applicationId: appId } });
      await notifyApplicant(tx, tenantId, id, application.userId, userId, appId, "info_requested");
      return { status: "info_requested" as const };
    }
    if (input.action === "decline") {
      await tx.update(communityApplications).set({ status: "declined", decidedBy: userId, decidedAt: now, updatedAt: now, ...noteChange }).where(key);
      await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "community.application_decline", targetId: id, metadata: { applicationId: appId } });
      await notifyApplicant(tx, tenantId, id, application.userId, userId, appId, "declined");
      return { status: "declined" as const };
    }
    const where = and(eq(communityMemberships.tenantId, tenantId), eq(communityMemberships.communityId, id), eq(communityMemberships.userId, application.userId));
    const [membership] = await tx.select().from(communityMemberships).where(where).for("update");
    if (membership?.status === "banned") throw new AccessError(409, message("Errors.communityMemberBanned"));
    const fields = { status: "active" as const, role: "member" as const, joinedAt: now, updatedAt: now, joinAnswers: application.answers,
      rulesVersionAccepted: application.rulesVersion, adultConfirmedAt: application.adultConfirmedAt };
    if (!membership) await tx.insert(communityMemberships).values({ tenantId, communityId: id, userId: application.userId, ...fields });
    // Re-entry never restores a staff role (ADR 0013 §4a); an already active member keeps their role.
    else if (membership.status !== "active") await tx.update(communityMemberships).set(fields).where(where);
    await tx.insert(entitlements).values({ tenantId, userId: application.userId, resourceType: "community", resourceId: id, source: "application", grantedBy: userId });
    await tx.update(communityApplications).set({ status: "approved", decidedBy: userId, decidedAt: now, updatedAt: now, ...noteChange }).where(key);
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "community.application_approve", targetId: id, metadata: { applicationId: appId } });
    await notifyApplicant(tx, tenantId, id, application.userId, userId, appId, "approved");
    return { status: "approved" as const };
  });
}
