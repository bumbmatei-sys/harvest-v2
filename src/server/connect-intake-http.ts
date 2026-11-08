import { getDb } from "../db/client";
import { message } from "../i18n/messages";
import { verifyOrigin, errorResponse } from "./http";
import { requireSyntheticIntake, submitIntake, applyIntakeRights } from "./connect-intake";
export const intakeHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export async function intakeBody(request: Request) {
  if (request.headers.get("content-type")?.split(";",1)[0] !== "application/json") throw new SyntaxError("INVALID_CONTENT_TYPE");
  const reader = request.body?.getReader(); if (!reader) throw new SyntaxError("EMPTY_BODY");
  const chunks: Uint8Array[]=[];let total=0;
  try { while(true) { const {done,value}=await reader.read();if(done)break;total+=value.byteLength;
    if(total>32768){await reader.cancel();throw new SyntaxError("BODY_TOO_LARGE");}chunks.push(value);
  } } finally { reader.releaseLock(); }
  let text: string;
  try { text = new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)); } catch { throw new SyntaxError("INVALID_ENCODING"); }
  return JSON.parse(text);
}
export async function handleIntake(request: Request, source?: { kind: string; code: string }) {
  try {
    requireSyntheticIntake();verifyOrigin(request);
    const body=await intakeBody(request);
    if (!source) {
      const result = await applyIntakeRights(getDb(),body);
      return result.limited ? Response.json({error:message("Intake.limited")},{status:429,headers:{...intakeHeaders,"Retry-After":"60"}}) : Response.json(result,{headers:intakeHeaders});
    }
    const result=await submitIntake(getDb(),source.kind,source.code,body);
    if(result.limited)return Response.json({error:message("Intake.limited")},{status:429,headers:{...intakeHeaders,"Retry-After":"60"}});
    return Response.json(result,{status:result.replayed?200:201,headers:intakeHeaders});
  } catch(error) {
    const response=errorResponse(error);for(const [key,value]of Object.entries(intakeHeaders))response.headers.set(key,value);return response;
  }
}
