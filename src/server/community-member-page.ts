import { redirect } from "next/navigation";
import { AccessError } from "./permissions";

/** Member pages render alongside the member layout; a non-reader is sent to the public page rather than an error. */
export function orPublicPage(slug: string) {
  return (error: unknown): never => {
    if (error instanceof AccessError && error.status === 404) redirect(`/communities/${encodeURIComponent(slug)}`);
    throw error;
  };
}
