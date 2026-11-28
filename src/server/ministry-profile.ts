import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { files, ministryLocations, ministryProfileFields, ministryProfiles } from "../db/schema";
import { message } from "../i18n/messages";
import { coverMimes } from "../lib/forum";
import { ministryMapsLink, profileImageField, saveMinistryProfileInput } from "../lib/ministry-profile";
import { AccessError } from "./permissions";
import type { ImageMime, StorageAdapter } from "./storage/adapter";
import { withTenant } from "./tenancy";
import { appOriginIfConfigured } from "../lib/site-address";

type Image = { key: string; name: string; mime: ImageMime };
type ImageField = z.infer<typeof profileImageField>;
type Location = Omit<typeof ministryLocations.$inferSelect, "tenantId">;
type Profile = { fields: Record<string, unknown>; locations: Location[] };
type PublicLocation = Omit<Location, "visibility">;
type PublicProjection = {
  fields: Record<string, unknown>;
  locations: Array<{ id: string; name: string; address1: string; address2: string | null; city: string; region: string | null;
    postal_code: string | null; country: string; service_times: string[]; is_primary: boolean }>;
};
const missing = () => new AccessError(404, message("Errors.thisViewIsNotAvailable"));
const conflict = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"));
const staff = (role: string) => role === "owner" || role === "admin";

async function inMinistry<T>(db: Database, user: string, tenant: string, run: (tx: Transaction, id: string, role: string) => Promise<T>) {
  try {
    return await withTenant(db, user, z.uuid().parse(tenant), "workspace:read", (tx, id, _effectiveRole, role) => {
      if (!staff(role) && role !== "member") throw missing();
      return run(tx, id, role);
    });
  } catch (error) {
    if (error instanceof AccessError && error.status === 403) throw missing();
    throw error;
  }
}

async function chosenImage(tx: Transaction, tenant: string, id: string): Promise<Image | undefined> {
  const [row] = await tx.select({ key: files.key, name: files.name, mime: files.mime }).from(files).where(and(
    eq(files.tenantId, tenant), eq(files.id, id), eq(files.status, "ready"), eq(files.visibility, "private"),
    eq(files.socialUpload, false), inArray(files.mime, [...coverMimes]),
  ));
  return row ? { ...row, mime: row.mime as ImageMime } : undefined;
}

function imageHref(tenant: string, field: string, isPublic: boolean) {
  const scope = isPublic ? "public/ministries" : "workspaces";
  const path = `/api/${scope}/${encodeURIComponent(tenant)}/profile/images/${encodeURIComponent(field)}`;
  const base = appOriginIfConfigured();
  return base ? new URL(path, base).href : path;
}

function presented<T extends PublicLocation>(tenant: string, data: { fields: Profile["fields"]; locations: T[] }, isPublic: boolean) {
  const fields = { ...data.fields };
  for (const field of profileImageField.options) if (fields[field]) fields[field] = imageHref(tenant, field, isPublic);
  return { fields, locations: data.locations.map(location => ({ ...location, mapsHref: ministryMapsLink(location) })) };
}

async function publicProjection<T>(db: Database, tenant: string, field: ImageField | null = null) {
  const { rows: [row] } = await db.execute<{ data: T | null }>(sql`
    select public.ministry_public_profile(${z.uuid().parse(tenant)}::uuid, ${field}::text) as data`);
  if (!row?.data) throw missing();
  return row.data;
}

export async function publicMinistryProfile(db: Database, tenant: string) {
  const data = await publicProjection<PublicProjection>(db, tenant);
  const locations = data.locations.map(({ postal_code, service_times, is_primary, ...location }) => ({
    ...location, postalCode: postal_code, serviceTimes: service_times, primary: is_primary,
  }));
  return presented(tenant, { fields: data.fields, locations }, true);
}

export function readMinistryProfile(db: Database, user: string, tenant: string) {
  return inMinistry(db, user, tenant, async (tx, id, role) => {
    const [profile] = await tx.select().from(ministryProfiles).where(eq(ministryProfiles.tenantId, id));
    if (!profile) {
      if (!staff(role)) throw missing();
      return { version: 0, published: false, fields: {}, locations: [], settings: {} };
    }
    const rows = await tx.select().from(ministryProfileFields).where(eq(ministryProfileFields.tenantId, id));
    const rawLocations = await tx.select().from(ministryLocations).where(eq(ministryLocations.tenantId, id))
      .orderBy(desc(ministryLocations.primary), asc(ministryLocations.name), asc(ministryLocations.id));
    const fields = Object.fromEntries(rows.map(({ field, value }) => [field, value]));
    const locations = rawLocations.map(({ id, name, address1, address2, city, region, postalCode, country, serviceTimes, primary, visibility }) => ({
      id, name, address1, address2, city, region, postalCode, country, serviceTimes, primary,
      ...(staff(role) ? { visibility } : {}),
    }));
    const result = presented(id, { fields, locations }, false);
    if (!staff(role)) return result;
    return { ...result, version: profile.version, published: profile.published,
      settings: Object.fromEntries(rows.map(({ field, visibility, value }) => [field, { value, visibility }])) };
  });
}

export function saveMinistryProfile(db: Database, user: string, tenant: string, raw: unknown) {
  return inMinistry(db, user, tenant, async (tx, id, role) => {
    if (!staff(role)) throw missing();
    const input = saveMinistryProfileInput.parse(raw);
    const [created] = await tx.insert(ministryProfiles).values({ tenantId: id }).onConflictDoNothing().returning();
    const [current] = await tx.select().from(ministryProfiles).where(eq(ministryProfiles.tenantId, id)).for("update");
    if (input.version !== (created ? 0 : current.version)) throw conflict();
    for (const [field, setting] of Object.entries(input.fields ?? {})) {
      const key = and(eq(ministryProfileFields.tenantId, id), eq(ministryProfileFields.field, field));
      if (setting === null) {
        await tx.delete(ministryProfileFields).where(key);
        continue;
      }
      if (setting === undefined) continue;
      if (profileImageField.safeParse(field).success && (typeof setting.value !== "string" || !await chosenImage(tx, id, setting.value))) throw missing();
      if (role !== "owner" && ["email", "phone"].includes(field) && setting.visibility === "public") throw missing();
      await tx.insert(ministryProfileFields).values({ tenantId: id, field, ...setting })
        .onConflictDoUpdate({ target: [ministryProfileFields.tenantId, ministryProfileFields.field], set: setting });
    }
    if (input.locations) {
      const existing = await tx.select({ id: ministryLocations.id }).from(ministryLocations).where(eq(ministryLocations.tenantId, id));
      const ids = new Set(existing.map(location => location.id));
      if (input.locations.some(location => location.id && !ids.has(location.id))) throw missing();
      await tx.delete(ministryLocations).where(eq(ministryLocations.tenantId, id));
      if (input.locations.length) await tx.insert(ministryLocations).values(input.locations.map(item => ({ ...item, tenantId: id })));
    }
    const published = input.published ?? current.published;
    if (published) {
      const [name] = await tx.select().from(ministryProfileFields).where(and(
        eq(ministryProfileFields.tenantId, id), eq(ministryProfileFields.field, "name"), eq(ministryProfileFields.visibility, "public"),
      ));
      if (!name) throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
    }
    const version = current.version + 1;
    await tx.update(ministryProfiles).set({ published, version }).where(eq(ministryProfiles.tenantId, id));
    return { published, version };
  });
}

export async function ministryProfileImage(db: Database, storage: (subject: string | null) => StorageAdapter, tenant: string, rawField: string, user?: string) {
  const parsed = profileImageField.safeParse(rawField);
  if (!parsed.success) throw missing();
  const field = parsed.data;
  const image = user ? await inMinistry(db, user, tenant, async (tx, id) => {
    const [setting] = await tx.select({ value: ministryProfileFields.value }).from(ministryProfileFields).where(and(
      eq(ministryProfileFields.tenantId, id), eq(ministryProfileFields.field, field),
    ));
    return typeof setting?.value === "string" ? chosenImage(tx, id, setting.value) : undefined;
  }) : await publicProjection<Image>(db, tenant, field);
  if (!image) throw missing();
  return storage(user ?? null).presignDownload(image.key, image.name, { inlineImage: image.mime });
}
