import { communityLiveRoute, listLiveEvents, saveLiveEvent } from "@/server/community-live";
export const runtime = "nodejs";
export const GET = communityLiveRoute<{ slug:string; eventId:string }>(async ({ db,user,params }) => (await listLiveEvents(db,user,params.slug,params.eventId))[0],{ write:false });
export const PUT = communityLiveRoute<{ slug:string; eventId:string }>(({ db,user,params,body }) => saveLiveEvent(db,user,params.slug,params.eventId,body),{ write:true });
