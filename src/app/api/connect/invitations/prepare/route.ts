import { invitationHttp } from "@/server/connect-invitation-http";
export const runtime="nodejs";
export const POST=(request:Request)=>invitationHttp(request,"prepare");
