import { respondToCrmForm, type CrmFormContext } from "@/server/crm-form-http";

export const runtime = "nodejs";

export function GET(request: Request, context: CrmFormContext) {
  return respondToCrmForm(request, context, false);
}
