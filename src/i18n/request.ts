import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { eq } from "drizzle-orm";
import { getAuth } from "@/server/auth-instance";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { resolveLocale } from "./locale";

export default getRequestConfig(async () => {
  const requestHeaders = await headers();
  const cookieStore = await cookies();
  let userLocale: string | null = null;
  // Avoid initializing the database on anonymous requests.
  if (cookieStore.has("better-auth.session_token") || cookieStore.has("__Secure-better-auth.session_token")) {
    const session = await getAuth().api.getSession({ headers: requestHeaders });
    if (session) {
      const [user] = await getDb().select({ locale: users.locale }).from(users).where(eq(users.id, session.user.id)).limit(1);
      userLocale = user?.locale ?? null;
    }
  }
  const locale = resolveLocale(userLocale, cookieStore.get("locale")?.value, requestHeaders.get("accept-language"));
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
