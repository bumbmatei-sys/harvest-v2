import "server-only";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { AccessError } from "./permissions";
import { eventsEnabled } from "./events";

/** Events pages answer 404 before any session work while Events are off. */
export function requireEvents() { if (!eventsEnabled()) notFound(); }
/**
 * One neutral answer for everything the viewer may not see: a missing event, a draft, another ministry's event, a malformed id.
 * The page never says which one it was.
 */
export async function orNotFound<T>(work: Promise<T>): Promise<T> {
  try { return await work; } catch (error) {
    if ((error instanceof AccessError && (error.status === 404 || error.status === 400)) || error instanceof ZodError) notFound();
    throw error;
  }
}
/** The request's clock, read once per page and passed down so server and client render the same phases. */
export const serverNow = () => Date.now();
export const upcomingRange = (now: number) => ({ from: new Date(now).toISOString(), to: new Date(now + 99 * 86_400_000).toISOString() });
