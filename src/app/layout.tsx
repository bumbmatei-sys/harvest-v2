import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
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
import "./globals.css";
export const metadata: Metadata = { title: "Harvest", description: "Your Harvest workspace" };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
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
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBootstrap(brandTheme) }} /></head><body className={GeistSans.variable}>{children}</body></html>;
}
