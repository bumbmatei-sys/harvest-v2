import "server-only";
import { communitiesEnabled } from "./communities-mode";
import type { OfficeDeps } from "./office-provider/connections";
import { FakeOfficeProvider } from "./office-provider/fake-provider";
import { OfficeMailReview } from "./office-provider/review";

export function officeGateOpen(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production" && communitiesEnabled(env);
}

let synthetic: OfficeDeps | undefined;
export function officeRouteDeps(): OfficeDeps | null {
  if (!officeGateOpen()) return null;
  const now = () => new Date();
  const credential = { secret: "harvest-office-test-credential" };
  synthetic ??= { credential, provider: new FakeOfficeProvider(credential.secret, now, true), now, review: new OfficeMailReview(now) };
  return synthetic;
}
