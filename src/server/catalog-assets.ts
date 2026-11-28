import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { catalogItems, files } from "../db/schema";
import { message } from "../i18n/messages";
import { downloadDisposition } from "../lib/download-filename";
import { requiredEnv } from "../lib/env";
import { coverMimes } from "../lib/forum";
import { freeCatalogEnabled } from "./free-catalog-mode";
import { AccessError } from "./permissions";
import { withTenant, withUser } from "./tenancy";
import { workerSettings } from "./worker-settings";

const uuid = z.uuid();
const slugInput = z.string().regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/);
const missing = () => new AccessError(404, message("Errors.fileNotFound"));
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
export const resourceLinkSeconds = 60;
const signature = (secret: string, parts: (string | number)[]) =>
  createHmac("sha256", secret).update(JSON.stringify(["catalog-attachment:v1", ...parts])).digest();
const resourceKey = () => workerSettings.getStore()?.grantSecret ?? requiredEnv("FILE_GRANT_SECRET");

type Resource = { lessonId: string; lessonTitle: string; fileId: string; name: string; mime: string; size: number };
type Asset = { key: string; name: string; mime: string; size: number };
type OpenAsset = (key: string) => Promise<ReadableStream<Uint8Array> | null>;

function attachmentLink(secret: string, user: string, slug: string, resource: Resource, expires: number) {
  const { lessonId, fileId } = resource;
  const token = `${expires}.${signature(secret, [user, slug, lessonId, fileId, expires]).toString("base64url")}`;
  return `/api/catalog/${slug}/lessons/${lessonId}/attachments/${fileId}?grant=${token}`;
}

export function validCatalogResourceGrant(secret: string, user: string, slug: string, lesson: string, file: string, grant: string | null, now: number) {
  const match = /^(\d{1,12})\.([a-zA-Z0-9_-]{43})$/.exec(grant ?? "");
  if (!match) return false;
  const expires = Number(match[1]);
  if (expires <= now || expires > now + resourceLinkSeconds) return false;
  const supplied = Buffer.from(match[2], "base64url");
  return supplied.length === 32 && timingSafeEqual(signature(secret, [user, slug, lesson, file, expires]), supplied);
}

async function asset<T>(db: Database, user: string, slug: string, action: string, file: string | null = null, lesson: string | null = null) {
  if (!freeCatalogEnabled() || !slugInput.safeParse(slug).success) throw missing();
  const query = sql`select public.catalog_assets(${slug},${action},${file}::uuid,${lesson}::uuid) as data`;
  const { rows } = user ? await withUser(db, user, tx => tx.execute<{ data: T | null }>(query)) :
    await db.execute<{ data: T | null }>(query);
  const data = rows[0]?.data;
  if (data == null) throw missing();
  return data;
}

function assetResponse(file: Asset, body: ReadableStream<Uint8Array>, inline: boolean) {
  return new Response(body, { headers: { ...headers, "Content-Type": inline ? file.mime : "application/octet-stream",
    "Content-Length": String(file.size), "Content-Disposition": inline ? "inline" : downloadDisposition(file.name) } });
}

export async function courseResources(db: Database, user: string, slug: string, secret = resourceKey(), now = Math.floor(Date.now() / 1000)) {
  const resources = await asset<Resource[]>(db, user, slug, "resources");
  return { expiresIn: resourceLinkSeconds, items: resources.map(file => ({ ...file,
    downloadHref: attachmentLink(secret, user, slug, file, now + resourceLinkSeconds) })) };
}

export async function downloadCourseResource(db: Database, user: string, slug: string, lesson: string, fileId: string, grant: string | null,
  open: OpenAsset, secret = resourceKey(), now = Math.floor(Date.now() / 1000)) {
  if (!uuid.safeParse(lesson).success || !uuid.safeParse(fileId).success ||
      !validCatalogResourceGrant(secret, user, slug, lesson, fileId, grant, now)) throw missing();
  const file = await asset<Asset>(db, user, slug, "attachment", fileId, lesson);
  const body = await open(file.key);
  if (!body) throw missing();
  return assetResponse(file, body, false);
}

export async function publicCatalogCover(db: Database, user: string, slug: string, open: OpenAsset) {
  const file = await asset<Asset>(db, user, slug, "cover");
  const body = await open(file.key);
  if (!body) throw missing();
  return assetResponse(file, body, true);
}

export async function editorCatalogCover(db: Database, user: string, tenant: string, id: string, open: OpenAsset) {
  const file = await withTenant(db, user, uuid.parse(tenant), "catalog:manage", async (tx, scope) => {
    const [image] = await tx.select({ key: files.key, name: files.name, mime: files.mime, size: files.size })
      .from(catalogItems).innerJoin(files, and(eq(files.tenantId, catalogItems.tenantId), eq(files.id, catalogItems.coverFileId)))
      .where(and(eq(catalogItems.tenantId, scope), eq(catalogItems.id, uuid.parse(id)), eq(files.status, "ready"),
        eq(files.visibility, "private"), eq(files.socialUpload, false), inArray(files.mime, [...coverMimes])));
    return image;
  });
  if (!file) throw missing();
  const body = await open(file.key);
  if (!body) throw missing();
  return assetResponse(file, body, true);
}

type DirectoryRow = { id: string; kind: "course" | "download"; slug: string; title: string; summary: string; priceLabel: string;
  cover: boolean; author: { id: string; name: string } | null };
const page = z.object({ author: z.string().min(1).max(128).optional(), after: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24) }).strict();
export async function publicCatalogDirectory(db: Database, tenant: string, query: unknown) {
  if (!freeCatalogEnabled()) throw missing();
  const { author, after, limit } = page.parse(query);
  const { rows: [{ data }] } = await db.execute<{ data: { items: DirectoryRow[]; next: string | null } }>(sql`
    select public.catalog_directory(${uuid.parse(tenant)}::uuid,${author ?? null},${after ?? null}::uuid,${limit}) as data`);
  return { next: data.next, items: data.items.map(({ cover, ...item }) => ({
    ...item, coverHref: cover ? `/api/catalog/${item.slug}/cover` : null,
  })) };
}
