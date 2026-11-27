# Native blog, slice 1 (PRs #315 and #316)

Status: draft PRs, not merged, nothing deployed or activated. Migration `0135_native_blog` (the final number is assigned at merge time).

## Founder decisions (27 Nov 2026)

1. **Address.** The blog uses the same name as the ministry's link in bio: `/l/<handle>` and `/blog/<handle>`. When a ministry first opens its blog, the address defaults to its link-in-bio handle if it has one, otherwise to the suggestion from the ministry name. It never takes an address another blog already has. **Delivered:** the default. **Follow-up:** keeping the two names in sync when either one is changed later (a later PR, coordinated with the link-in-bio builder).
2. **Pictures for Website collaborators.** Website access includes blog pictures: a collaborator with Website at manage can upload and choose pictures for the blog only, without browsing all of Files. **Follow-up:** this needs a blog-only upload and picker path. Slice 1 picks pictures from Files, so today only people who can read Files (owners, admins, members) can add them.
3. **Scheduled publish needs no audit row.** The article record (who scheduled it, when it was published) is enough. **Delivered:** no audit row from the worker job.

## Review fixes (#315 review, CHANGES-REQUESTED on 898a0bc)

- **Blocker fixed.** The owner-role `blog_public_definer` policy on `public.files` now also requires `status = 'ready'`, `NOT social_upload`, an image type, and a published article of the same ministry that uses the file (cover, share picture or body picture). Integration test: as the owner role with both flags set by hand, a draft's picture, a PDF and another ministry's picture are not visible.
- The blog address stays fixed once any article was ever published, even after every article is deleted. This uses a `blog_settings.first_published_at` marker, set by an AFTER trigger on the first publish and never cleared.
- A first publish updates the blog row in the same transaction, so a concurrent address change waits for it and then sees the marker.
- The database stamps a manual publish with `now()`, whatever the caller sends.

## Evidence

The integration tests in `tests/integration/blog.test.ts` (20) and the unit tests in `tests/unit/blog.test.ts` live in #315. The browser test `tests/e2e/blog.spec.ts` lives in #316, with axe at 1280 and 360 in light and dark. The PR bodies give the test counts and what was not run.
