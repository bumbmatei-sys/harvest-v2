import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { publishIntakeForm } from "@/server/connect-intake";
import { intakeBody,intakeHeaders } from "@/server/connect-intake-http";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{tenantId:string;campaignId:string}>}) {
 try { verifyOrigin(request);const user=await verifiedUser(request),p=await context.params;
  return Response.json(await publishIntakeForm(getDb(),user,p.tenantId,p.campaignId,await intakeBody(request)),{status:201,headers:intakeHeaders});
 } catch(error){return errorResponse(error);}
}
