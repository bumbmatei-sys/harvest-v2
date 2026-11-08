import { invitationHttp } from "@/server/connect-invitation-http";
export const runtime="nodejs";
export const GET=(request:Request)=>invitationHttp(request,"continuation");
