# Newsletter images: upload, cover image and video block

Image upload for the email editor, an email cover image and a video block with a play-button thumbnail. No migration, no new dependency, no navigation entry. Sending stays hard-off; test sends go to the synthetic sink only. All five HC-02 gates remain UNAPPROVED.

## Done

- **Upload.** One shared `ImagePicker` (`src/components/newsletter/image-picker.tsx`) serves the cover, the new Image block, the hero and Image with text blocks and the video thumbnail: choose or drop a file, upload with progress and Cancel, pick a previously uploaded ministry image from the library, or keep a secure https link. Replace and Remove. Modelled on the event cover picker (same states: preparing, uploading, checking, scan pending with Check again, type, size, dimensions, rejected, interrupted, failed, scan failed).
- **Pipeline.** Routes `GET/POST /newsletter/images`, `POST /newsletter/images/[fileId]/confirm` (`src/server/newsletter-campaigns/images.ts`). A newsletter image is an ordinary ministry file (`files`: public, not social) in the existing storage layout: signed PUT slot, byte inspection (size, type, checksum), scanner. It is released only on a clean scan; a skipped scan releases it outside production only (the event cover and community upload rule, `communityUploadReleased`); in production it stays unavailable until a real scanner exists. Only the uploader confirms. Owners and admins only (`newsletter:campaigns`); members and strangers get 404 on every route.
- **Limits.** JPEG, PNG, WebP; up to 5 MB; at most 4000 px on a side (checked in the browser before the upload); extension must match the type; no paths or control characters in names.
- **Alt text.** Required for uploaded images and for the Image block unless "Decorative image" is on (alt then renders as an empty `alt=""`). Enforced by the document schema (a draft without it is not saved) and shown inline. Older linked images keep the existing inbox-check warning and are not rejected.
- **Use only after the scan.** Documents store the file id, not an address. The server resolves ids to public addresses (`documentImages`) only for files that are ready, public, image type and in the same ministry; otherwise saving, reviewing, previewing and the test send fail with 409 `IMAGE_UNAVAILABLE`. The renderer uses only that server-supplied map, and only https addresses (the editor preview alone also accepts this app's own `/api/files/public/...` path). Public addresses redirect to a fresh signed address; image files are now served inline with their image type.
- **Cover image.** Optional `cover` on the email document (same picker). Rendered first, table-based, full width up to 600 px (`width="600"`, `max-width:600px`), alt text, plain-text `[alt]`. No crop or position: the event picker has neither (it shows a fixed 16:9 frame), so the email keeps the image's own proportions.
- **Image block.** New block (`image`): uploaded or linked picture, alt/decorative, optional https link around it.
- **Video block.** Paste a link: https only, no credentials. `parseVideoLink` recognises YouTube and VK by exact host allowlists (never substring matches); everything else is a plain link. The email shows the thumbnail with a table-drawn play button linking to the video (cell background image, VML fallback for Outlook), a "Watch the video" text link and the plain-text line "Watch the video: <url>". The thumbnail is always one the user uploaded or chose. For a YouTube link a button "Use the video's thumbnail" is offered; it runs server side (non-production only), fetches `https://img.youtube.com/vi/<id>/hqdefault.jpg` built only from the validated id, stores it as a normal upload and runs the same scan. Nothing is hotlinked in the email. VK and other links need an uploaded thumbnail. UI copy says "Video" and names no vendor.
- Brand-kit and editor previews update at once (preview uses the public path; the render context flag `preview` is never set on a server path).

## Deferred

- **GIF.** The shared `files` table only allows JPEG, PNG, WebP, PDF and text (`files_mime`), and the byte inspector has no GIF signature. Supporting GIF needs a migration (number 0092 was offered) plus the inspector change. Not done; decision needed.
- **Server-side pixel dimensions.** The 4000 px limit is checked in the browser; the server enforces type, size and bytes. Reading dimensions on the server needs the storage adapter to expose the object head.
- **Sending path.** `newsletter_delivery_authorize` (migration 0073) reads campaign content as a block list and does not yet understand version 2 documents or file-backed images; it must be extended (migration) before sending is ever activated. Hard-off today.
- Cleanup of abandoned pending image uploads (no worker for newsletter images yet; same gap as ministry files).
- Real malware scanner (activation gate). Crop/position for covers. A standalone library management screen (delete images).

## Hard-off

Sending, scheduling and provider calls unchanged. The thumbnail suggestion returns 404 in production and the editor hides the button there. No real outbound traffic in tests (loopback storage mock; the suggestion fetch is faked in the integration test and only presence-checked in the browser test).

## Evidence

- Unit `tests/unit/newsletter-images.test.ts` (link parsing incl. look-alike hosts and credentials, limits, alt rule, cover/image/video render output with escaping, https-only, plain text), existing `email-blocks` and `newsletter-sending` tests.
- Integration `tests/integration/newsletter-images.test.ts` (8): upload shape, limits, scan states (clean, infected, skipped in and out of production, size mismatch), library lists only ready images, restricted roles (member, stranger, other admin) get 404, cross-ministry isolation, drafts refuse unscanned or missing images and render the public address, suggestion pipeline and its gates.
- Playwright `tests/e2e/newsletter-images.spec.ts`: wrong type and oversize make no request, upload, alt rule, library, decorative, video link validation, suggestion button presence, preview decode, persistence, test send; axe WCAG 2.2 AA and no horizontal overflow at 360, 768, 1280 in light and dark; run with shell modes on and `HARVEST_SHELL_MODES=disabled`. The existing `newsletter-campaigns` spec still passes.
- Screenshots: `docs/screenshots/newsletter-images/`.

## Provenance

Layout and behaviour follow the event cover picker (itself modelled on the premium kit's pos-system image drop zone, admin-dashboard 1631106, 3% identical). No kit file was copied for this change, so `docs/ui-sources.md` and `src/lib/ui-provenance.ts` are unchanged. Shared components only (Button, Dialog, Input, Label, Progress, Spinner, Switch, FormSection).
