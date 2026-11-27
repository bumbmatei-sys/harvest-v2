import { fundraisingEnabled } from "./fundraising";
import { waysToGiveEnabled } from "./ways-to-give-mode";

/** The public fundraising page (/give/<slug>), its owner section and routes: development-only, never in production (the fundraising and Ways to give gates). */
export function givePageEnabled(env: Record<string, string | undefined> = process.env) { return fundraisingEnabled(env) && waysToGiveEnabled(env); }
