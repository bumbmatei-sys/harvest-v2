import { respondToCrmForm, type CrmFormContext } from "@/server/crm-form-http";

export const runtime = "nodejs";

export function POST(request: Request, context: CrmFormContext) {
  return respondToCrmForm(request, context, true);
}
