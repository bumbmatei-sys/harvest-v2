import { cookies } from "next/headers";
import { getDb } from "../db/client";
import { getAuth } from "./auth-instance";
import { verifyOrigin, errorResponse } from "./http";
import { intakeBody, intakeHeaders } from "./connect-intake-http";
import { requireSyntheticIntake } from "./connect-intake-context";
import { requestInvitation,prepareInvitation,readInvitationFlow,consumeInvitation } from "./connect-invitations";
import { AccessError } from "./permissions";
import { message } from "../i18n/messages";
export const invitationFlowCookie="harvest_connect_flow";
export async function invitationHttp(request:Request,action:"request"|"prepare"|"claim"|"continuation") {
 try {
  requireSyntheticIntake();if(action!=="continuation")verifyOrigin(request);
  const db=getDb(),jar=await cookies();
  if(action==="request"){
   const result=await requestInvitation(db,await intakeBody(request));
   return result.limited?Response.json({error:message("Intake.limited")},{status:429,headers:{...intakeHeaders,"Retry-After":"60"}}):Response.json(result,{headers:intakeHeaders});
  }
  if(action==="prepare"){
   // A failed new-token attempt must not silently resume an unrelated older browser flow.
   jar.delete(invitationFlowCookie);
   const flow=await prepareInvitation(db,await intakeBody(request));
   jar.set(invitationFlowCookie,flow,{httpOnly:true,sameSite:"lax",secure:new URL(request.url).protocol==="https:",path:"/",maxAge:600});
   return Response.json({ready:true},{headers:intakeHeaders});
  }
  const flow=jar.get(invitationFlowCookie)?.value;
  if(action==="continuation"){
   const valid=flow?await readInvitationFlow(db,flow):null;
   return Response.json({next:valid?"/connect/claim":"/account/welcome"},{headers:intakeHeaders});
  }
  const session=await getAuth().api.getSession({headers:request.headers});
  if(!session)throw new AccessError(401,message("Errors.signInToContinue"));
  if(!flow)throw new AccessError(409,message("Invitations.unavailable"));
  const result=await consumeInvitation(db,flow,session.user,await intakeBody(request));
  return Response.json(result,{headers:intakeHeaders});
 }catch(e){const r=errorResponse(e);for(const [key,value]of Object.entries(intakeHeaders))r.headers.set(key,value);return r;}
}
