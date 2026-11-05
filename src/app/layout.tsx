import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import { themeBootstrap } from "@/lib/theme";
import { headers } from "next/headers";
import { getAuth } from "@/server/auth-instance";
import { getWorkspace } from "@/server/workspaces";
import { getDb } from "@/db/client";
import { AccessError } from "@/server/permissions";
import type { BrandTheme } from "@/lib/theme";
import { RegisterServiceWorker } from "@/components/register-service-worker";
import { themeStyles } from "@/lib/theme-registry";
import "./globals.css";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return { title: t("title"), description: t("description") };
}
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  let brandTheme: BrandTheme = "harvest";
  const requestHeaders = await headers();
  const workspace = requestHeaders.get("x-harvest-workspace");
  if (workspace) {
    try {
      const session = await getAuth().api.getSession({ headers: requestHeaders });
      if (session) brandTheme = (await getWorkspace(getDb(), session.user.id, workspace)).brandTheme;
    } catch (error) {
      if (!(error instanceof AccessError)) console.error("workspace_theme_load_failed");
    }
  }
  return <html lang={locale} className={GeistSans.variable} suppressHydrationWarning><head><style dangerouslySetInnerHTML={{ __html: themeStyles }} /><script dangerouslySetInnerHTML={{ __html: themeBootstrap(brandTheme) }} /></head><body><NextIntlClientProvider><RegisterServiceWorker />{children}</NextIntlClientProvider></body></html>;
}
