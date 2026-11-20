# Social Publish server acceptance

Migration **0069** follows **0068** on main. The branch adds server facilities for S01 and S02 of the approved Social design.

## Contract for the screens

Routes below use `/api/workspaces/[tenantId]/social`. Owner and admin authorization is checked in the service and through FORCE RLS. Draft, schedule and upload writes check the request origin. Identifiers outside the caller’s visibility produce a neutral 404. Sensitive responses are private and no-store.

| Route | Operations |
| --- | --- |
| `GET /connections` | Account status and health, publish and inbox capabilities, active or unavailable state, and media rules for each post type |
| `GET /drafts`, `POST /drafts` | List unscheduled drafts, or save a typed document with common text, media IDs, connections, and per-platform variants |
| `POST /drafts/preview` | Return the rendered text, same/custom mode, counter, errors and warnings, and a disposition for each attachment, cover and subtitle by destination |
| `GET /drafts/:id`, `PATCH /drafts/:id` | Read the document and deliveries, or apply a versioned `save`, `duplicate`, `editAfterAttempt`, `review`, `publishNow`, `schedule`, `move`, `moveDelivery`, `cancel` or `retry` |
| `GET /schedules`, `POST /schedules` | List and create named schedules, one ministry default and one optional schedule per platform |
| `PATCH /schedules/:id`, `DELETE /schedules/:id` | Update or archive a schedule by version. A schedule with pending deliveries must be cleared first. |
| `GET /schedules/:id/queue` | Page through pending deliveries for the schedule |
| `GET /planner` | Filter half-open UTC ranges by status, account and platform, with day and Monday-start week groups in the requested timezone, a bounded cursor and a reserved `counters` field |
| `POST /media`, `POST /media/:id/parts`, `POST /media/:id/confirm` | Create a private upload, sign a single PUT or an individual multipart part, and confirm against trusted bytes, metadata and a clean scan |

The browser can import `platformCharacterCounters` from `src/lib/social/characters.ts`. Server validation calls those same functions. Each result has `used`, `limit`, `remaining` and a rule status. The shared functions normalize pasted line endings to LF just as the draft API does. For Bluesky, the post counter is based on graphemes and the server also checks UTF-8 bytes. X applies weighted Unicode counting and 23-character links. X URL extraction and the character units for the other providers still require parity evidence. A limit labeled `estimate` is a shared Harvest estimate. An unavailable limit is `null`.

A review response contains the resolved content and destination list plus an expiring token. The token is scoped to the actor, draft, version and connection versions. Saving after review invalidates it. Publish now creates due records for the worker. The worker asks the adapter to publish immediately and omits provider-side scheduling. A weekly slot uses an IANA timezone. Spring gaps are skipped, fall overlaps use the earlier occurrence, and each reserved instant is saved as UTC with its display timezone.

The group lives in `social_drafts` and each destination, delivery attempt history and scheduled repeat uses `social_posts`. Legacy rows retain their existing delivery behavior. An edit after an attempt creates a new draft. If the caller does not supply a document, the copy excludes destinations with a published, pending-provider or unknown result. A repeat interval creates at most one pending copy per destination after confirmed publishing. A rule stops repeats by date or copy count. The grouped worker uses the same idempotency key when a known failed delivery can be retried. A timeout, missing response or expired claim is unknown. A signed event can reconcile a grouped delivery by provider reference or the opaque Harvest delivery key echoed in post metadata. Audit records use IDs and action names.

## Platform and media evidence

Public documentation was read on **20 November 2026**. The provider’s posting overview lists 16 destination keys. The account inventory also recognizes its Blogs destinations and messaging-only connections surfaced in the provider’s account catalog. Ads, telephony infrastructure, commerce/catalog operations, CRM, analytics, and office accounts have separate contracts. The platform catalog and the provider’s generated API schema are the evidence for the mappings below. [Platform catalog](https://docs.zernio.com/platforms) · [Create post](https://docs.zernio.com/posts/create-post) · [Account listing](https://docs.zernio.com/accounts/list-accounts) · [Official generated types at f98ece5](https://github.com/zernio-dev/zernio-node/blob/f98ece5fad2b1d07f4c328cb96cd87de52910997/src/generated/types.gen.ts)

| Platform key | Documented Publish and media evidence |
| --- | --- |
| `twitter` | Feed text, photos, GIF or video. Weighted text with 23-character links. X Articles require an eligible account and a structured body. The media guide says 20 photos while the post guide says four. Harvest uses four pending parity evidence. GIF and video are single-asset alternatives. The platform supports image alt text, one video subtitle track and an AI media label. [Posts and articles](https://docs.zernio.com/platforms/twitter/posts) · [Media](https://docs.zernio.com/platforms/twitter/media) |
| `instagram` | Images, mixed carousels, Stories and Reels. JPEG/PNG images and MP4/MOV video. Feed alt text, first comment, AI disclosure and reel cover or frame offset. The overview and media guide give different Reel duration limits. Harvest uses the shorter published limit. [Instagram](https://docs.zernio.com/platforms/instagram) · [Media](https://docs.zernio.com/platforms/instagram/media) |
| `facebook` | Feed, image and video Story, and vertical Reel. Feed image carousel, GIF, video cover, feed and Reel subtitles, first comment outside Stories, and image alt text. [Facebook](https://docs.zernio.com/platforms/facebook) · [Media](https://docs.zernio.com/platforms/facebook/media) |
| `linkedin` | Text, up to 20 images, GIF, video or one PDF, PPT, PPTX, DOC or DOCX. Image alt text, first comment, video cover and one English subtitle track. Harvest uses the personal-account duration limit pending confirmed organization metadata. [LinkedIn](https://docs.zernio.com/platforms/linkedin) · [Media](https://docs.zernio.com/platforms/linkedin/media) |
| `tiktok` | Video or photo carousel. Platform-specific privacy and two confirmations are required. Video AI disclosure, cover image or frame, and separate text limits by media type. Inbox access depends on account eligibility. [TikTok](https://docs.zernio.com/platforms/tiktok) · [Media](https://docs.zernio.com/platforms/tiktok/media) |
| `youtube` | Video and Shorts, thumbnails, SRT or WebVTT tracks, and synthetic-content disclosure. Harvest uses the unverified-channel duration limit for long video pending account metadata. The per-platform and generic thumbnail docs disagree on size. Harvest uses the smaller bound. [YouTube](https://docs.zernio.com/platforms/youtube) · [Media](https://docs.zernio.com/platforms/youtube/media) |
| `pinterest` | Single image, animated GIF or video pin, destination link, board, alt text, optional cover image or frame, and AI disclosure. [Pinterest](https://docs.zernio.com/platforms/pinterest) · [Media](https://docs.zernio.com/platforms/pinterest/media) |
| `reddit` | Text, link, image/gallery, or native MP4. Subreddit rules apply. The media guide supplies the image and video size limits. A video poster is documented. [Reddit](https://docs.zernio.com/platforms/reddit) · [Media](https://docs.zernio.com/platforms/reddit/media) |
| `bluesky` | Text, images or MP4. The provider describes grapheme counting and a UTF-8 byte cap. The generated schema lists alt text and video captions. [Bluesky](https://docs.zernio.com/platforms/bluesky/reference) · [Media](https://docs.zernio.com/platforms/bluesky/media) |
| `threads` | Text, images, MP4 and mixed carousels. The media guide distinguishes the image-only and mixed item counts. Image alt text and first comment. [Threads](https://docs.zernio.com/platforms/threads) · [Media](https://docs.zernio.com/platforms/threads/media) |
| `googlebusiness` | Updates, JPEG/PNG image and an HTTPS call-to-action. Reviews are documented separately from DMs and comments. [Google Business Profile](https://docs.zernio.com/platforms/google-business/reference) |
| `telegram` | Channel/group text, photos, videos, documents and albums. Text and captions have different limits. Inbox requires a bot connection. [Telegram](https://docs.zernio.com/platforms/telegram) |
| `discord` | Channel messages and file attachments. The API also exposes forum posts and outbound bot DMs. Those DMs cannot receive replies through the inbox. [Discord](https://docs.zernio.com/platforms/discord) |
| `slack` | Channel text and up to 10 files. Slack can silently truncate channel text above its limit. Inbox access is conditional. [Slack](https://docs.zernio.com/platforms/slack) |
| `snapchat` | Closed beta for image or video Stories, Saved Stories and Spotlight. Harvest reports Publish unavailable. [Snapchat](https://docs.zernio.com/platforms/snapchat) |
| `whatsapp` | The posting overview includes WhatsApp. Its platform and generated docs describe recipient messaging, templates and broadcasts. The ordinary social draft has no recipient or template contract, so Publish is unavailable. [WhatsApp](https://docs.zernio.com/platforms/whatsapp) |
| `wordpress` | Posts use the separate Blogs API. [WordPress](https://docs.zernio.com/platforms/wordpress) |
| `shopify` | Articles use the separate Blogs API. [Shopify](https://docs.zernio.com/platforms/shopify) |
| `wix` | Articles use the separate Blogs API. [Wix](https://docs.zernio.com/platforms/wix) |
| `webflow` | Articles use the separate Blogs API. [Webflow](https://docs.zernio.com/platforms/webflow) |
| `rcs` | Recipient messaging. [RCS](https://docs.zernio.com/platforms/rcs) |
| `imessage` | Private-beta inbox messaging. [iMessage](https://docs.zernio.com/platforms/imessage) |
| `line` | Recipient messaging. [LINE](https://docs.zernio.com/platforms/line) |
| `wechat` | Recipient messaging. [WeChat](https://docs.zernio.com/platforms/wechat) |
| `sms` | Recipient messaging tied to phone-number provisioning. [SMS](https://docs.zernio.com/platforms/sms) |

The versioned table in `src/lib/social/media.ts` lists what this composer accepts. For attached files, the service checks MIME, size, count and combination. It checks duration, dimensions or aspect ratio where a hard rule is represented. The browser receives attachment-specific accept/reject results. Harvest neither transcodes nor changes the selected presentation. Provider-native processing and account-dependent formats, quotas, and caps remain unverified. Some official text or media docs provide limits without the full validation algorithm.

## Verification and prerequisites

The test publisher uses the fake provider, injected credentials and synthetic releases. Both hard-off constants and the disabled sender remain in place. Inbox message and comment bodies remain live pass-through. The five HC-02 activation gates remain **UNAPPROVED**.

Hosted Neon, real provider behavior and the hosted storage/media pipeline require separate evidence. Video and image confirmation uses trusted inspection and a scanner port. With the default no-op scanner a social upload remains unready, and the HTTP handler has no production media inspector configured. Real account linking requires a reviewed OAuth ownership flow. Product decisions still pending are whether repeat expiry should also delete previous remote copies and the Blogs API article-distribution contract. Current repeat rules only stop future copies.
