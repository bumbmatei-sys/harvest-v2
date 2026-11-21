import "server-only";
import { OFFICE_INTEGRATION_ENABLED, type OfficeDeps } from "./connections";
import { OfficeMailReview } from "./review";
import type { Credential } from "./types";
import { ZernioOfficeAdapter } from "./zernio-adapter";

/** The caller supplies the same server-side credential used for Social, never an Office token. */
export function liveOfficeDeps(credential?: Credential): OfficeDeps | null {
  if (!OFFICE_INTEGRATION_ENABLED || !credential) return null;
  const now = () => new Date();
  return { credential, provider: new ZernioOfficeAdapter(), now, review: new OfficeMailReview(now) };
}
