import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { users } from "../db/schema";
import { locales } from "../i18n/locale";
import { withUser } from "./tenancy";

export function getProfile(db: Database, userId: string) {
  return withUser(db, userId, async (tx) => {
    const [profile] = await tx.select({ email: users.email, locale: users.locale }).from(users).where(eq(users.id, userId));
    return profile;
  });
}
export function updateProfile(db: Database, userId: string, raw: unknown) {
  const { locale } = z.object({ locale: z.enum(locales).nullable() }).strict().parse(raw);
  return withUser(db, userId, async (tx) => {
    const [profile] = await tx.update(users).set({ locale, updatedAt: new Date() }).where(eq(users.id, userId))
      .returning({ locale: users.locale });
    return profile;
  });
}
