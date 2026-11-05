# Themes

`src/lib/theme-registry.ts` is the palette source for Harvest and Studio, with light and dark modes for each. It generates selectors for the application, appearance previews and public offline page. `src/app/globals.css` maps the registry variables onto semantic shadcn tokens such as `background`, `foreground`, `card`, `primary`, `destructive` and `sidebar`. Components use these tokens instead of literal colors or Tailwind palette classes.

To add a theme, add a complete light/dark definition to that one registry file and its display-name translation under `ThemeNames` in `messages/en.json`. The registry derives the allowed theme IDs, controls, validation and selectors. Components require no changes. Persistent workspace themes are constrained by PostgreSQL, so making a new theme selectable as a workspace default also requires an additive migration to the existing database constraint. Rebuild and regenerate the offline page, then run the registry and browser tests.

The user's validated local preference overrides the workspace default. Without a user mode preference, light/dark follows the system. A bootstrap script applies both axes before paint; controls follow storage and system changes. Invalid stored values fall back to the workspace or Harvest. Appearance changes require the existing server-side workspace permissions.

Gold primary and hover backgrounds always use the dark `--earth` foreground through `--primary-foreground`. Never use white text on gold. Unit tests enforce at least 4.5:1 contrast for those pairs and key text/surface pairs; browser axe checks cover every main screen in all four variants.

`npm run lint` and source-guard unit tests reject raw hex, RGB/HSL/OKLCH values and Tailwind palette utilities outside the registry. The generated public CSS and image assets contain resolved colors by design. Browser tests additionally inspect rendered class names and inline styles and save synthetic-data screenshots and axe results to `docs/screenshots/pr03/`.
