import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth-instance";
export async function pageSession(context:"default"|"personal"="default") {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect(context==="personal"?"/sign-in?personal=1":"/sign-in");
  return session;
}
/** The session if signed in, otherwise null; never redirects (public pages). */
export async function optionalSession() {
  return getAuth().api.getSession({ headers: await headers() });
}
