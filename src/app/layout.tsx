import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Harvest", description: "Your Harvest workspace" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={GeistSans.variable}>{children}</body></html>;
}
