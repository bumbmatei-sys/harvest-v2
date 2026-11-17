import { describe, expect, it, vi } from "vitest";
import { liveAutoCloseDue, liveEmbedUrl, liveInWindow, liveStates, liveTransitionAllowed, parseLiveVideoUrl } from "../../src/lib/community-live";
import { communityCan } from "../../src/lib/community-permissions";
import { can } from "../../src/lib/permissions";
vi.mock("server-only",()=>({}));
const id="dQw4w9WgXcQ";
describe("Live URL allowlist",()=>{
  for(const host of ["youtube.com","www.youtube.com","m.youtube.com","youtube-nocookie.com","www.youtube-nocookie.com"])
    for(const path of [`watch?v=${id}`,`live/${id}`,`embed/${id}`,`shorts/${id}`]) it(`${host}/${path}`,()=>expect(parseLiveVideoUrl(`https://${host}/${path}`)).toBe(id));
  it("short link and canonical embed",()=>{expect(parseLiveVideoUrl(`https://youtu.be/${id}`)).toBe(id);expect(liveEmbedUrl(id)).toBe(`https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&modestbranding=1`);expect(()=>liveEmbedUrl('../evil')).toThrow();});
  for(const value of [`javascript:alert(1)`,`data:text/html,evil`,`http://youtube.com/watch?v=${id}`,`https://youtube.com.evil.test/watch?v=${id}`,`https://evilyoutube.com/watch?v=${id}`,`https://youtube.com@evil.test/watch?v=${id}`,`https://a@youtube.com/watch?v=${id}`,`https://youtube.com:444/watch?v=${id}`,`https://youtube.com/watch?v=${id}&v=${id}`,`https://youtube.com/watch?v=${id}&autoplay=1`,`https://youtu.be/${id}?t=1`,`https://youtube.com/watch?v=${id}#x`,`https://youtube.com/watch?v=short`,`https://youtube.com/embed/%2f${id}`,`https://youtube.com\\@evil.test/${id}`,` https://youtu.be/${id}`])
    it(`rejects ${value}`,()=>expect(parseLiveVideoUrl(value)).toBeNull());
});
it("state matrix",()=>{const edges=["draft:scheduled","draft:cancelled","scheduled:live","scheduled:cancelled","live:ended","ended:replay","replay:ended"];for(const a of liveStates)for(const b of liveStates)expect(liveTransitionAllowed(a,b)).toBe(a===b||edges.includes(`${a}:${b}`));});
it("window boundaries and explicit replay",()=>{const start=new Date('2026-11-17T12:00:00Z');for(const [delta,visible] of [[-86400001,false],[-86400000,true],[7*86400000,true],[7*86400000+1,false]] as const)expect(liveInWindow('scheduled',start,null,new Date(+start+delta))).toBe(visible);expect(liveInWindow('draft',start,null,start)).toBe(false);expect(liveInWindow('cancelled',start,null,start)).toBe(false);expect(liveInWindow('replay',start,start,new Date('2030-01-01'))).toBe(true);});
it("auto-close is based on actual start and never publishes replay",()=>{const start=new Date();expect(liveAutoCloseDue('live',start,new Date(+start+12*3600000-1))).toBe(false);expect(liveAutoCloseDue('live',start,new Date(+start+12*3600000))).toBe(true);expect(liveAutoCloseDue('live',null,new Date())).toBe(false);expect(liveAutoCloseDue('replay',start,new Date(+start+13*3600000))).toBe(false);});
it("capabilities keep moderator management denied",()=>{for(const r of ['owner','admin']){expect(can(r,'community:live:manage')).toBe(true);expect(communityCan(r,'community:live:manage')).toBe(true);}for(const r of ['moderator','contributor','member','viewer'])expect(communityCan(r,'community:live:manage')).toBe(false);expect(communityCan('moderator','community:live:moderate')).toBe(true);expect(can('viewer','community:live:view')).toBe(false);});
it("production gate cannot be enabled by the Communities flag",async()=>{
 const { communityLiveEnabled,communityLiveRoute }=await import('../../src/server/community-live');
 expect(communityLiveEnabled({NODE_ENV:'production',HARVEST_COMMUNITIES:'enabled'})).toBe(false);
 expect(communityLiveEnabled({NODE_ENV:'test'})).toBe(true);
 vi.stubEnv('NODE_ENV','production');vi.stubEnv('HARVEST_COMMUNITIES','enabled');
 try {const run=vi.fn();const response=await communityLiveRoute(run,{write:false})(new Request('https://harvest.test/api/communities/test/live'),{params:Promise.resolve({slug:'test'})});expect(response.status).toBe(404);expect(run).not.toHaveBeenCalled();}finally{vi.unstubAllEnvs();}
});
