import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withUser } from "./tenancy";

const searchText = z.string().trim().max(120).transform(value => value || null);
const listingQuery = z.object({ name: searchText.nullable(), cityRegion: searchText.nullable(), after: z.uuid().nullable() });
const optInInput = z.object({ optedIn: z.boolean() }).strict();
const pageSize = 50;

type Entry = {
  ministryId: string;
  name: string;
  fields: Record<string, unknown>;
  locations: Array<{ name: string; city: string; region: string | null; country: string; serviceTimes: string[] }>;
};

export async function searchChurchDirectory(db: Database, input: unknown) {
  const { name, cityRegion, after } = listingQuery.parse(input);
  const { rows: [row] } = await db.execute<{ items: Entry[] }>(
    sql`select public.church_directory_search(${name}, ${cityRegion}, ${after}::uuid) as items`,
  );
  const items = row.items.slice(0, pageSize);
  return { items, next: row.items.length > pageSize ? items.at(-1)?.ministryId ?? null : null };
}

export async function setChurchDirectoryOptIn(db: Database, user: string, rawTenant: string, input: unknown) {
  const tenant = z.uuid().parse(rawTenant);
  const { optedIn } = optInInput.parse(input);
  const { rows: [row] } = await withUser(db, user, tx => tx.execute<{ allowed: boolean }>(
    sql`select public.church_directory_opt_in(${tenant}::uuid, ${optedIn}) as allowed`,
  ));
  if (!row.allowed) throw new AccessError(404, message("Errors.thisViewIsNotAvailable"));
  return { optedIn };
}
