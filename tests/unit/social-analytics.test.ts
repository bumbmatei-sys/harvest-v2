import { expect, it, vi } from "vitest";
import { analyticsCapabilities, projectMetrics } from "../../src/lib/social/analytics";
import { socialPlatforms } from "../../src/lib/social/platforms";
import { ZernioAdapter } from "../../src/server/social/zernio-adapter";

const credential = { secret:"synthetic-fixture" };
const query = { accountRef:"authorized", platform:"instagram" as const, signal:AbortSignal.timeout(1000),
  from:"2026-10-01",to:"2026-10-31" };
const page = { ...query,page:1,limit:10,order:"date" as const };

it("makes the documented analytics matrix exhaustive and omits unserved platform metrics", () => {
  const postPlatforms=socialPlatforms.filter(platform=>analyticsCapabilities(platform).post.length);
  expect(postPlatforms).toEqual(["twitter","instagram","facebook","linkedin","tiktok","youtube","pinterest","reddit","bluesky","threads","snapchat"]);
  const profilePlatforms=socialPlatforms.filter(platform=>analyticsCapabilities(platform).account.includes("profileViews"));
  expect(profilePlatforms).toEqual(["instagram","facebook","linkedin","tiktok"]);
  expect(analyticsCapabilities("reddit").post).toEqual(["score","comments"]);
  expect(analyticsCapabilities("googlebusiness")).toEqual({post:[],account:[],bestTimes:false});
  expect(projectMetrics({likes:0,reach:null,views:Infinity,comments:"1",shares:-3,score:-2,body:"canary"},
    ["likes","reach","views","comments","shares","score"])).toEqual({likes:0,score:-2});
});

it("projects only the authorized account and documented fields from a provider post page", async () => {
  const fetch = vi.fn(async () => Response.json({ posts:[
    { _id:"external-ref",latePostId:"planner-ref",publishedAt:"2026-10-25T14:00:00Z",content:"body-canary",mediaType:"video",mediaProductType:"REELS",
      analytics:{likes:900},platforms:[
        {accountId:"other",platform:"instagram",analytics:{likes:800}},
        {accountId:"authorized",platform:"facebook",analytics:{likes:700}},
        {accountId:"authorized",platform:"instagram",platformPostId:"native-ref",syncStatus:"synced",analytics:{
          likes:0, reach:320, clicks:0, views:230, igReelsVideoViewTotalTime:8000, body:"metric-canary" }},
      ]},
    { _id:"inaccessible",publishedAt:"2026-10-15T14:00:00Z",platforms:[{accountId:"other",platform:"instagram",analytics:{likes:900}}]},
    { _id:"pending",publishedAt:"2026-10-15T14:00:00Z",platforms:[{accountId:"authorized",platform:"instagram",syncStatus:"pending",analytics:{likes:0}}]},
  ],pagination:{pages:2} }));
  const vendor = new ZernioAdapter({fetch});
  const result=await vendor.readPostAnalytics(credential,page);
  expect(result).toEqual({posts:[
    {ref:"planner-ref",nativeRef:"native-ref",publishedAt:new Date("2026-10-25T14:00:00Z"),metrics:{likes:0,reach:320,views:230,videoViews:230,watchTimeSeconds:8}},
    {ref:"pending",nativeRef:undefined,publishedAt:new Date("2026-10-15T14:00:00Z"),metrics:{}},
  ],nextPage:2,pending:true});
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("accountId=authorized"),expect.objectContaining({method:"GET",redirect:"error"}));
});

it("maps daily profile and follower values, preserves measured zero and excludes cross-account follower data", async () => {
  const fetch=vi.fn(async (url:string) => {
    if (url.includes("follower-stats")) return Response.json({stats:{authorized:[{date:"2026-10-31",followers:0}],other:[{date:"2026-10-30",followers:900}]}});
    return Response.json({accountId:"authorized",metrics:{profile_views:{total:0}},unavailableMetrics:[]});
  });
  const vendor=new ZernioAdapter({fetch});
  expect(await vendor.readAccountAnalytics(credential,query)).toEqual({days:[{day:"2026-10-31",metrics:{followers:0,profileViews:0}}],partial:false});
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("fromDate=2026-10-31"),expect.objectContaining({method:"GET"}));
});

it("preserves only numeric heatmap slots and propagates an explicit provider backoff", async () => {
  const results=[Response.json({slots:[{day_of_week:6,hour:3,avg_engagement:0,post_count:1},{day_of_week:6,hour:24,avg_engagement:6,post_count:2}]}),
    new Response("body-canary",{status:429,headers:{"Retry-After":"120"}})];
  const vendor=new ZernioAdapter({fetch:async()=>results.shift()!});
  expect(await vendor.readBestPostingTimes(credential,query)).toEqual([{day:6,hour:3,engagement:0,samples:1}]);
  await expect(vendor.readPostAnalytics(credential,page)).rejects.toMatchObject({code:"RATE_LIMITED",retryAfterMs:120_000});
});

it("keeps analytics network access disabled without an injected transport", async () => {
  const fetch=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("Network used"));
  try {
    const vendor=new ZernioAdapter();
    await expect(vendor.readPostAnalytics(credential,page)).rejects.toMatchObject({code:"DISABLED"});
    await expect(vendor.readBestPostingTimes(credential,query)).rejects.toMatchObject({code:"DISABLED"});
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});

it("uses YouTube daily analytics for share and watch metrics instead of placeholder zeroes", async () => {
  const vendor=new ZernioAdapter({fetch:async url=> url.includes("daily-views")
    ? Response.json({videoId:"native-ref",dailyViews:[{shares:0,estimatedMinutesWatched:1},{shares:2,estimatedMinutesWatched:3.2}]})
    : Response.json({posts:[{_id:"youtube-1",publishedAt:"2026-10-20T12:34:00Z",mediaType:"video",
      platforms:[{accountId:"authorized",platform:"youtube",platformPostId:"native-ref",analytics:{views:10,shares:0}}]}]})});
  const data=await vendor.readPostAnalytics(credential,{...page,platform:"youtube"});
  expect(data.posts[0].metrics).toMatchObject({shares:2,watchTimeSeconds:252,videoViews:10});
});

it("requires LinkedIn account-type evidence for measured saves and clicks", async () => {
  const vendor=new ZernioAdapter({fetch:async url=> url.includes("linkedin-post-analytics")
    ? Response.json({accountId:"authorized",postUrn:"urn:li:share:1",accountType:"organization",analytics:{clicks:0,saves:0}})
    : Response.json({posts:[{_id:"linkedin-1",publishedAt:"2026-10-20T12:34:00Z",mediaType:"text",
      platforms:[{accountId:"authorized",platform:"linkedin",platformPostId:"urn:li:share:1",analytics:{impressions:3,views:0,clicks:0,saves:0}}]}]})});
  const data=await vendor.readPostAnalytics(credential,{...page,platform:"linkedin"});
  expect(data.posts[0].metrics).toEqual({impressions:3,clicks:0});
});
