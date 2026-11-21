import { getTranslations } from "next-intl/server";
import type { Database } from "../db/client";
import { listAssignableMembers } from "./follow-up-members";
import { listPipelines } from "./crm-deals";

/** What the Forms screens offer for "Saves to": People, Organizations and each pipeline (a submission creates the person; pipelines are where a follow-up deal would go). */
export async function destinationOptions(db: Database, userId: string, tenantId: string) {
  const t = await getTranslations("CrmForms.destination");
  const pipelines = await listPipelines(db, userId, tenantId);
  const options = [{ value: "people", label: t("people") }, { value: "organizations", label: t("organizations") },
    ...pipelines.map((pipeline) => ({ value: `pipeline:${pipeline.id}`, label: t("pipeline", { name: pipeline.name }) }))];
  return { options, labels: Object.fromEntries(options.map((option) => [option.value, option.label])) as Record<string, string> };
}
export const assignableMembers = listAssignableMembers;
