import { communityLiveRoute, listLiveEvents, saveLiveEvent } from "@/server/community-live";
export const runtime = "nodejs";
export const GET = communityLiveRoute<{ slug: string }>(({ db,user,params }) => listLiveEvents(db,user,params.slug),{ write:false });
export const POST = communityLiveRoute<{ slug: string }>(({ db,user,params,body }) => saveLiveEvent(db,user,params.slug,null,body),{ write:true });
