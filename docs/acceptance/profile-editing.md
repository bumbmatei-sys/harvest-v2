# Profile editing in Settings (C09b) acceptance

One feature PR on the merged member-profile server (#150, #154; migrations 0062 and 0066). No migration, no new dependency, no new route. Nothing here approves any HC-02 gate, activation or deployment. The member-profile routes stay hard-off in production.

## What was built

The **You > Profile** section of the Settings pop-up (#175) was a basic form; it is now the real editing screen (`src/components/settings/profile-panel.tsx`, moved out of `settings-panels.tsx`).

| Part | Behaviour |
| --- | --- |
| Fields | Display name (100), bio (500), language (80), up to three links, visibility. A community picker when the person belongs to several. |
| Links | Label and https address per row, add up to three, remove, **move up and move down** (icon buttons, 44px on phones, disabled at the ends). Validation mirrors the server (`src/lib/profile-links.ts`: https only, no spaces, backslashes, control characters or sign-in details, 40 and 2048 limits). Errors appear per field after the first save attempt, with `aria-invalid`, `aria-describedby`, and focus moves to the first bad field; nothing is sent while a link is invalid. A completely empty row is dropped, not reported. |
| Visibility | Three radio rows: Members ("Shown in the members list."), Unlisted ("Not in the list; members with your link can open it."), Private ("Only you and this community's owners and admins."). |
| Save | The shared `StickySaveBar` (Save profile, Discard, "Unsaved changes"): it exists only while the draft differs from the stored profile (whitespace and blank rows do not count). Enter in a field saves. Success toast "Profile saved."; failures toast the catalogue message. |
| Revision check | Every save, hide and clear sends the loaded `version`. A 409 shows "Your profile changed somewhere else, so nothing was saved." with **Load the latest version**, which replaces the draft with the stored profile. Nothing is overwritten silently. |
| Unsaved changes | The bar's own guard covers in-app links, Back/Forward and closing the tab. New: the pop-up asks "Discard your changes?" (Keep editing / Discard) before Escape, the Close button, another section, or another community in the picker would drop edits. A clean pop-up closes without asking. |
| Hide profile | The server's `withdraw`: sets Private and keeps the details. Confirm dialog (Cancel has first focus). Shown only while the stored profile is not already Private. |
| Clear profile | The server's `erase`: removes display name, bio, language and links and sets visibility back to Members. The dialog says what goes and what stays: "Your posts and your account are not affected." Destructive confirm. If edits are unsaved the dialog adds that they are discarded. The account name is untouched (checked). |
| How others see it | A **View profile page** button opens the existing member profile page (`/communities/:slug/members/:userId`) in a new tab, so unsaved edits in the pop-up are not lost and there is no second preview implementation. |

Copy is concise: no routine helper line under any field; the only explanatory text is the visibility consequences, the hide/clear/discard confirmations and the conflict message. Provider-neutral wording, "community" for the picker, "ministry" untouched.

## Reuse

Shared Field and FieldError, Input, Textarea, RadioGroup, NativeSelect, Button (responsive sizes), Alert, Skeleton, EmptyState, `StickySaveBar`, `ConfirmDialog`, `useUnsavedChangesGuard` (inside the bar), the toast helper and `useRequest`. No new abstraction, no new dependency, no drag library (move buttons keep reordering keyboard-operable). The Settings dialog gained one small mechanism: a `guard(proceed)` callback and a dirty flag handed to the panel, used for close, section switch and the community picker.

## Server

No server behaviour changed. One additive field: `shellSettings` now also returns the viewer's own `userId` (only while the member-profile routes are on, only for themselves) so the panel can build the link to their profile page. Covered by `tests/integration/shell-settings.test.ts`.

## Verified

See the PR description for the exact commands and results. Browser spec `tests/e2e/profile-editing.spec.ts` (one test): empty profile; edit and save every field; reorder, remove and the limit of three; reload shows the stored profile; link validation (not https, missing label, sign-in details; no request sent); Enter saves; keyboard reorder; Discard in the bar; visibility Unlisted, Private and Members each checked as another member (page status and members list) and as the owner (a private profile still opens); the View profile page link; conflict and Load the latest version; the guard on Escape, Close, section switch and tab close; Hide (Cancel, then confirm; details kept); Clear (what stays; account name unchanged); 44px targets at 360px; axe (wcag2a, 2aa, 21aa, 22aa) and no horizontal overflow (page and panel) in light and dark at 360, 768 and 1280 for the edited, link-error, conflict, hide-confirm, clear-confirm, dirty and saved states. `tests/unit/profile-links.test.ts` covers the address rules, row issues, reorder and dirty state. The existing `settings-popup.spec.ts` was updated for the new bar and guard.

Screenshots: `docs/screenshots/profile-editing/` (42 files: seven states, three widths, light and dark).

## Not built or not verified

- **The member profile page does not show bio, links or language.** Those voluntary fields are stored and editable here but the page from #147 renders only name, role, joined date, counts and activity, so "how it looks to others" is limited to what that page shows today. Showing the fields to eligible viewers is a separate change (server projection `community_member_profile_read` already returns them).
- Avatar upload stays parked (scanner gate). Per-field privacy is not built; Private is whole-profile.
- A profile is per community; there is no account-wide profile here (the Account section keeps name, language and city).
- Drag-and-drop link reordering is not built; move buttons only.
- Mobile behaviour was checked in desktop Chromium at 360px, not on a device. Evidence is author-executed; no independent review yet.
