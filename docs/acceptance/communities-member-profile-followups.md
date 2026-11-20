# Community member profile follow-ups

## Behavior

- The members page applies profile visibility before sorting and limiting the directory. A listed profile uses its chosen display name, with the account name as the fallback.
- The member profile page uses the same direct, scoped lookup as the member-profile API. Its name follows that API's visibility rules. Unlisted profiles work by direct link, and a readable profile can be found past the directory's 1,000-row cap. Unknown people, non-members, former members and inaccessible private profiles receive the same 404. Activity keeps its existing forum permissions.
- Chat and private messages use their shared server bootstrap, which keeps chat eligibility independent of the members directory. A member whose profile is `private` or `unlisted` (other than the viewer) is hidden from non-owner/admin viewers. A hidden owner, admin or moderator is returned as an id and a role only (no name, no joined date, no profile fields), solely so the viewer's moderation actions on a message author respect rank. A hidden contributor or plain member is omitted entirely and leaves no trace in the page payload, whether or not they have posted; a screen that meets one as a message author or private-message partner takes the name from the message or conversation and shows the role as member. Hidden members never appear in mention suggestions, channel member lists or member counts. Community owners and admins, and the pre-existing ministry-staff path, still see everyone by name. A member always sees themselves by name. No display name, bio, language, links, blocking or opt-out data is part of the roster.
- Forum post and reply authors, chat authors and mentions, and private-message partners retain their account names. A chosen profile display name is shown on the member profile and, for `members` visibility, in the directory. This keeps existing conversation identities consistent and keeps an unlisted or private display name out of chat and forum.
- Erase clears the voluntary fields and resets visibility to `members`. An otherwise eligible member returns to the directory under their account name. Withdraw keeps its existing `private` behavior. Previously erased empty rows cannot be distinguished from intentionally empty private profiles, so migration 0066 preserves their stored visibility.

## Migration and scope

Migration `0066_member_profile_followups` changes the roster and erasure functions. It follows migration 0064 from #152 and 0065 from #153, both open when work began. Their commits were applied in order onto current main for testing. The screen already called the page service, so the lookup changed there without editing the screen.

All five HC-02 gates remain **UNAPPROVED**. Hosted Neon and production were outside verification scope.

## Verification

Lint and typecheck passed locally. The full unit project passed 1,218 tests in 95 files. The full integration project passed 883 tests in 106 files against disposable loopback PostgreSQL.

The 44 focused integration tests exercised the chat roster and author projection, the per-person profile lookup, and erasure.
