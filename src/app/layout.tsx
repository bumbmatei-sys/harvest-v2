import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import { themeBootstrap } from "@/lib/theme";
import "./globals.css";
export const metadata: Metadata = { title: "Harvest", description: "Your Harvest workspace" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBootstrap() }} /></head><body className={GeistSans.variable}>{children}</body></html>;
}
