import { getDb } from "@/db/client";
import { newsletterClickRedirect } from "@/server/newsletter-clicks";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => newsletterClickRedirect(getDb(), request, true);
export const HEAD = (request: Request) => newsletterClickRedirect(getDb(), request, false);
