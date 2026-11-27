# Blog definer scope reset

Migration `0138_blog_scope_clear` replaces the helper in place and revokes execution from PUBLIC and `harvest_app`. The helper clears and restores the full newsletter settings `app.nl02_tenant` and `app.nl02_private` used by owner-role policies. It preserves the other entries from the native blog migration, including `app.account_export`.

The native blog and community integration checks now recognize digits in flag names. The native blog check compares the explicit reset list with flags in all owner-role policies. The account-export check already recognized digits.

Hosted Neon remains unverified. HC-02 activation gates remain **UNAPPROVED**.
