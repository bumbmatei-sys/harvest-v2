import { and, desc, eq, isNull, max, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { auditLogs, campaigns, forms, formVersions, privacyNoticeVersions } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { intakeDefinition, intakeRights, intakeSetup, intakeSubmission, type IntakeManifest } from "../lib/connect-intake";
import { normalizeShortCode, publicCodePattern } from "../lib/connect-links";
import { message } from "../i18n/messages";
import { syntheticIntakeEnabled } from "./connect-intake-mode";
import { intakeFingerprint, receiptHash, sealIntake, issueIntakeCapability, verifyIntakeCapability } from "./connect-intake-crypto";
import { AccessError } from "./permissions";
import { enqueueInvitation } from "./connect-invitations";
import { withTenant } from "./tenancy";

const unavailable = () => new AccessError(404, message("Intake.unavailable"));
export { requireSyntheticIntake, withSyntheticIntake } from "./connect-intake-context";
import { requireSyntheticIntake, withSyntheticIntake } from "./connect-intake-context";
function source(kind: string, code: string) {
  if (kind === "qr" && publicCodePattern.test(code)) return { kind, code };
  const normalized = kind === "short" ? normalizeShortCode(code) : undefined;
  if (normalized) return { kind, code: normalized };
  throw unavailable();
}
export async function readIntakeManifest(db: Database, kind: string, code: string): Promise<IntakeManifest | null> {
  if (!syntheticIntakeEnabled()) return null;
  const input = source(kind, code);
  return withSyntheticIntake(db, async tx => {
    const result = await tx.execute<{ manifest: IntakeManifest | null }>(sql`select public.connect_intake_manifest(${input.kind},${input.code}) as manifest`);
    const manifest = result.rows[0]?.manifest;
    if (!manifest) return null;
    intakeDefinition.parse(manifest.definition);
    const capability=issueIntakeCapability(input.kind,input.code,manifest.stamp);
    return { ...manifest, capability, receiptToken:receiptHash(capability) };
  });
}
export async function submitIntake(db: Database, kind: string, code: string, raw: unknown) {
  requireSyntheticIntake();
  const input = intakeSubmission.parse(raw), publicSource = source(kind, code);
  const replayUntil = verifyIntakeCapability(input.capability,publicSource.kind,publicSource.code,input.stamp);
  if (!replayUntil || receiptHash(input.capability)!==input.receiptToken) throw new AccessError(409,message("Intake.changed"));
  if (input.website) throw new AccessError(400, message("Intake.checkDetails"));
  const manifest = await readIntakeManifest(db, kind, code);
  if (!manifest) throw unavailable();
  if (manifest.stamp !== input.stamp) throw new AccessError(409, message("Intake.changed"));
  const emailNeeded = input.purposes.includes("account_communications") || input.purposes.includes("newsletter") || (input.purposes.includes("outreach_follow_up") && manifest.definition.followUpChannel === "email");
  const phoneNeeded = input.purposes.includes("outreach_follow_up") && manifest.definition.followUpChannel === "phone";
  // Reserved synthetic contacts only. There is deliberately no path accepting real addresses.
  if ((emailNeeded ? !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@example\.test$/i.test(input.email) : Boolean(input.email))
    || (phoneNeeded ? !/^\+155555501\d{2}$/.test(input.phone) : Boolean(input.phone))
    || (!manifest.definition.preferredName && input.preferredName)
    || input.purposes.some(p => !manifest.purposes.includes(p))) throw new AccessError(400, message("Intake.checkDetails"));
  const data = { stamp: input.stamp, purposes: [...input.purposes].sort(), preferredName: input.preferredName,
    email: input.email.toLowerCase(), phone: input.phone };
  const fingerprint = intakeFingerprint(data), hash = receiptHash(input.receiptToken);
  const sealed = sealIntake(data, `${publicSource.kind}:${publicSource.code}:${input.submissionId}:${hash}`);
  const outcome = await withSyntheticIntake(db, async tx => {
    const result = await tx.execute<{ outcome: string }>(sql`select public.submit_connect_intake(${publicSource.kind},${publicSource.code},${input.submissionId}::uuid,${input.stamp},${hash},${fingerprint},${sql.param(data.purposes)}::text[],${emailNeeded},${phoneNeeded},${JSON.stringify(sealed)}::jsonb,${replayUntil}::timestamptz) as outcome`);
    const outcome=result.rows[0]?.outcome;
    if((outcome==="created"||outcome==="replayed")&&data.purposes.includes("account_communications"))await enqueueInvitation(tx,hash,data.email);
    return outcome;
  });
  // Quota writes commit even on a refused submit; never throw from inside that transaction.
  if (outcome === "limited") return { limited: true } as const;
  if (outcome === "changed" || outcome === "conflict") throw new AccessError(409, message("Intake.changed"));
  if (outcome === "invalid") throw new AccessError(400, message("Intake.checkDetails"));
  if (outcome !== "created" && outcome !== "replayed") throw unavailable();
  return { limited: false, pending: true, replayed: outcome === "replayed" } as const;
}
export async function applyIntakeRights(db: Database, raw: unknown) {
  const input = intakeRights.parse(raw);
  const result = await withSyntheticIntake(db, tx => tx.execute<{ applied: boolean | null }>(sql`select public.connect_intake_rights(${receiptHash(input.receiptToken)},${input.action},${input.purpose ?? null}) as applied`));
  if (result.rows[0]?.applied === null) return { limited: true } as const;
  // Unknown/replayed/expired proof gets the same acknowledgement, never response data.
  return { acknowledged: true };
}
export async function purgeIntake(db: Database) {
  return withSyntheticIntake(db, async tx => {
    const result = await tx.execute<{ count: number }>(sql`select public.purge_connect_intake() as count`);
    return { purged: result.rows[0]?.count ?? 0 };
  });
}

export async function listIntakeForms(db: Database, userId: string, workspace: string, campaign: string) {
  requireSyntheticIntake();
  return withTenant(db, userId, uuidInput.parse(workspace), "connect:publish", async (tx, tenantId) => {
    const [parent] = await tx.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.tenantId,tenantId),eq(campaigns.id,uuidInput.parse(campaign)),isNull(campaigns.archivedAt)));
    if (!parent) throw unavailable();
    return tx.select({ id: formVersions.id, formId: forms.id, name: forms.name, version: formVersions.version, status: formVersions.status,
      definition: formVersions.definition, purposes: formVersions.offeredPurposes, notice: privacyNoticeVersions.body, retentionDays: formVersions.pendingRetentionDays })
      .from(formVersions).innerJoin(forms,and(eq(forms.tenantId,formVersions.tenantId),eq(forms.id,formVersions.formId)))
      .innerJoin(privacyNoticeVersions,and(eq(privacyNoticeVersions.tenantId,formVersions.tenantId),eq(privacyNoticeVersions.id,formVersions.noticeVersionId)))
      .where(and(eq(formVersions.tenantId,tenantId),isNull(forms.archivedAt),sql`${formVersions.definition}->>'kind' in ('connect-intake-v1','connect-intake-v2')`)).orderBy(desc(formVersions.createdAt)).limit(100);
  });
}
export async function publishIntakeForm(db: Database, userId: string, workspace: string, campaign: string, raw: unknown) {
  requireSyntheticIntake(); const input = intakeSetup.parse(raw);
  return withTenant(db,userId,uuidInput.parse(workspace),"connect:publish",async(tx,tenantId) => {
    const [parent] = await tx.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.tenantId,tenantId),eq(campaigns.id,uuidInput.parse(campaign)),isNull(campaigns.archivedAt)));
    if (!parent) throw unavailable();
    let formId = input.formId;
    if (formId) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenantId + formId},0))`);
      const [owned] = await tx.select({ id: forms.id }).from(forms).where(and(eq(forms.tenantId,tenantId),eq(forms.id,formId),isNull(forms.archivedAt)));
      if (!owned) throw unavailable();
    } else {
      const [created] = await tx.insert(forms).values({ tenantId, name: input.name, createdBy: userId }).returning({ id: forms.id });formId=created.id;
    }
    const [{ latest }] = await tx.select({ latest: max(formVersions.version) }).from(formVersions).where(and(eq(formVersions.tenantId,tenantId),eq(formVersions.formId,formId)));
    const version = (latest ?? 0)+1;
    const [notice] = await tx.insert(privacyNoticeVersions).values({ tenantId,noticeKey:`hc05-${formId}`,version,locale:"en",
      body:`Synthetic test notice: ${input.notice}`,bodySha256:"0".repeat(64),createdBy:userId }).returning({id:privacyNoticeVersions.id});
    const [created] = await tx.insert(formVersions).values({ tenantId,formId,version,definition:input.definition,offeredPurposes:input.purposes,
      noticeVersionId:notice.id,pendingRetentionDays:input.retentionDays,createdBy:userId }).returning({id:formVersions.id});
    await tx.update(formVersions).set({status:"published",publishedBy:userId}).where(and(eq(formVersions.tenantId,tenantId),eq(formVersions.id,created.id)));
    await tx.insert(auditLogs).values({tenantId,actorId:userId,action:"connect.form.publish",targetId:created.id});
    return { id:created.id, version };
  });
}
