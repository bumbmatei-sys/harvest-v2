# Personalized landing visual evidence

Author-generated Chromium 156 captures against disposable local PostgreSQL with synthetic data only. The implementation author inspected each state; these are not independent-reviewer screenshots. Both themes are asserted on the document, not inferred from filenames.

| Viewport / theme | Welcome editor | Save and publish controls | Shared draft preview | Published guest page |
| --- | --- | --- | --- | --- |
| mobile 390 × 844 / light | [Editor](editor-mobile-light.png) | [Actions](editor-actions-mobile-light.png) | [Preview](editor-preview-mobile-light.png) | [Guest](guest-mobile-light.png) |
| tablet 820 × 1180 / light | [Editor](editor-tablet-light.png) | [Actions](editor-actions-tablet-light.png) | [Preview](editor-preview-tablet-light.png) | [Guest](guest-tablet-light.png) |
| desktop 1440 × 1000 / light | [Editor](editor-desktop-light.png) | [Actions](editor-actions-desktop-light.png) | [Preview](editor-preview-desktop-light.png) | [Guest](guest-desktop-light.png) |
| mobile 390 × 844 / dark | [Editor](editor-mobile-dark.png) | [Actions](editor-actions-mobile-dark.png) | [Preview](editor-preview-mobile-dark.png) | [Guest](guest-mobile-dark.png) |
| tablet 820 × 1180 / dark | [Editor](editor-tablet-dark.png) | [Actions](editor-actions-tablet-dark.png) | [Preview](editor-preview-tablet-dark.png) | [Guest](guest-tablet-dark.png) |
| desktop 1440 × 1000 / dark | [Editor](editor-desktop-dark.png) | [Actions](editor-actions-desktop-dark.png) | [Preview](editor-preview-desktop-dark.png) | [Guest](guest-desktop-dark.png) |

The editor scrolls inside the application shell, so separate action and preview captures expose lower sections. The published page is captured in full. The walkthrough uses realistic welcome text and a readable course title. HTML-like strings and invalid links are exercised in a separate input-safety test and never appear in these product screenshots. Paid course labels, free Harvest badges and the prominent free path remain visible. The test source also verifies keyboard move/remove focus, the eight-card limit, member-only draft access, private drafts, stale conflict recovery, both URL types, disabled preview submission and unchecked guest consent choices.

[Metrics](metrics.json) record axe results, document and main-container overflow and measured control sizes for all 24 states. Every captured axe scan is clean, overflow is zero, and measured buttons, form controls and button-style links are at least 44 × 44px. Browser emulation does not certify physical devices or production traffic.
