import { deployedCommit } from "@/lib/deployed-commit";
// Lets the post-deploy smoke test wait until the release it is checking is live.
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ commit: deployedCommit() }, { headers: { "Cache-Control": "no-store" } });
}
