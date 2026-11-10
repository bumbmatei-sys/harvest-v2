import { getDb } from "../db/client";
import { getAuth } from "./auth-instance";
import { requireSyntheticIntake } from "./connect-intake-context";
import { applySubjectRights } from "./connect-subject-rights";
import { intakeBody,intakeHeaders } from "./connect-intake-http";
import { verifyOrigin,errorResponse } from "./http";
import { AccessError } from "./permissions";
import { message } from "../i18n/messages";
export async function subjectRightsHttp(request:Request){
 try{
  requireSyntheticIntake();verifyOrigin(request);
  const session=await getAuth().api.getSession({headers:request.headers});
  if(!session)throw new AccessError(401,message("Errors.signInToContinue"));
  return Response.json(await applySubjectRights(getDb(),session.user.id,await intakeBody(request)),{headers:intakeHeaders});
 }catch(error){const response=errorResponse(error);if(response.status===429)response.headers.set("Retry-After","60");for(const [key,value]of Object.entries(intakeHeaders))response.headers.set(key,value);return response;}
}
