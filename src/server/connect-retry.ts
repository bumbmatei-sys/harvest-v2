import { AccessError } from "./permissions";
import { message } from "../i18n/messages";
/** Retries whole transactions only; callers must not perform external I/O inside run. */
export async function retryConnectTransaction<T>(run:()=>Promise<T>,uniqueRace=false):Promise<T>{
 for(let attempt=0;;attempt++){
  try{return await run();}
  catch(error){
   let cause:unknown=error;let code:string|undefined;
   for(let depth=0;depth<5&&cause&&typeof cause==="object";depth++){
    const item=cause as {code?:string;cause?:unknown};code??=item.code;cause=item.cause;
   }
   if(!code||!["40001","40P01","55P03",...(uniqueRace?["23505"]:[])].includes(code))throw error;
   if(attempt>=2)throw new AccessError(409,message("Errors.thisRecordChangedReloadAndTryAgain"));
   await new Promise(resolve=>setTimeout(resolve,20*(attempt+1)));
  }
 }
}
