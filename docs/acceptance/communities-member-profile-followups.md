# Community member profile follow-ups

## Behavior

- The members page applies profile visibility before sorting and limiting the directory. A listed profile uses its chosen display name, with the account name as the fallback.
- The member profile page uses the same direct, scoped lookup as the member-profile API. Its name follows that API's visibility rules. Unlisted profiles work by direct link, and a readable profile can be found past the directory's 1,000-row cap. Unknown people, non-members, former members and inaccessible private profiles receive the same 404. Activity keeps its existing forum permissions.
- Chat and private messages use their shared server bootstrap to get the existing eligible names, roles and joined dates independently of the members directory. No profile visibility, display name, bio, language, links, blocking or opt-out data is part of that roster. The pre-existing staff path keeps its own scope and limit.
- Forum post and reply authors, chat authors and mentions, and private-message partners retain their account names. A chosen profile display name is shown on the member profile and, for `members` visibility, in the directory. This keeps existing conversation identities consistent and keeps an unlisted or private display name out of chat and forum.
- Erase clears the voluntary fields and resets visibility to `members`. An otherwise eligible member returns to the directory under their account name. Withdraw keeps its existing `private` behavior. Previously erased empty rows cannot be distinguished from intentionally empty private profiles, so migration 0066 preserves their stored visibility.

## Migration and scope

Migration `0066_member_profile_followups` changes the roster and erasure functions. It follows migration 0064 from #152 and 0065 from #153, both open when work began. Their commits were applied in order onto current main for testing. The screen already called the page service, so the lookup changed there without editing the screen.

All five HC-02 gates remain **UNAPPROVED**. Hosted Neon and production were outside verification scope.
