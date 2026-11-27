import { appLink, appOriginIfConfigured } from "../lib/site-address";
import { cache } from "react";
import { headers } from "next/headers";
import { blogPath } from "../lib/blog";
import { publicReadCharge } from "./public-read-limit";

/** One per-visitor charge per request, shared by a page's metadata and the page (React cache). Over the limit nothing is read. */
export const blogPageCharge = cache(async () => publicReadCharge(await headers(), "blog"));
/** An absolute address on this site (canonical links, Open Graph, RSS), or undefined when the site address is not configured. */
export function absoluteUrl(path: string) { return appOriginIfConfigured() ? appLink(path) : undefined; }
export const blogImagePath = (handle: string, fileId: string) => `${blogPath(handle)}/images/${fileId}`;
