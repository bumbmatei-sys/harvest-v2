# Shadcn UI Kit catalog map

Companion to [the adoption plan](shadcnuikit-adoption.md). Generated 16 Nov 2026 from the kit registry index (`/r/registry.json`, 1228 items) by a script over the downloaded index and items; nothing here is kit source. Counts are exact for the snapshot; the "Harvest module" and "Candidates" columns are planning judgement, not tested integrations.

## Totals

| Group | Items | Notes |
| --- | ---: | --- |
| components | 567 | Variant galleries of primitives; site reports 559 of 564 free |
| dashboard-ui | 236 | Shells, tables, forms, charts, dialogs; nearly all premium |
| marketing | 190 | Public-site sections; premium except a handful |
| application-ui | 70 | Kanban, calendar, chat, mail, todo, maps, gantt, AI chat; premium |
| examples | 70 | Small patterns; 14 free (site count) |
| ecommerce | 59 | Storefront UI; premium |
| illustrations | 36 | Animated art; all premium |
| **Total** | **1228** | 661 `registry:block` + 567 `registry:component` |

Free/premium: per-category counts for blocks and examples come from the badges on the kit's category pages (31 of 661 are free; the 36 illustrations are premium). Component variant pages carry no per-item badge; the site reports 559 of 564 components free, so `free*` means "almost all free" and the 5 premium component variants were not identified. Confirm per item before relying on it.

Extra npm packages = packages the category's items import beyond what Harvest already has (`lucide-react`, `date-fns`, `class-variance-authority`, `react-day-picker`, `cmdk`, `radix-ui`, `input-otp`, `@dnd-kit/core`).


## dashboard-ui (236)

| Category | Items | Free | Harvest module | Top candidates | Extra npm packages | Note |
| --- | ---: | --- | --- | --- | --- | --- |
| `dashboard-ui/charts` | 70 | 0 free / 70 pro | Analytics, finance, campaign and learning charts | chart56, chart69, chart52, chart60, chart45 | recharts | 82 items need recharts + ui/chart + --chart-1..5 tokens |
| `dashboard-ui/dashboard-shell` | 9 | 0 free / 9 pro | App shell, header, mobile nav | dashboard-shell8, dashboard-shell7, dashboard-shell1 | next-themes | Floating variants; reference for header actions only (shell stays the typed-registry AppShell) |
| `dashboard-ui/dropdown-components` | 10 | 0 free / 10 pro | Header menus: account, workspace switcher, notifications, columns | dashboard-dropdown7, dashboard-dropdown2, dashboard-dropdown10, dashboard-dropdown1 | @dnd-kit/utilities, @dnd-kit/modifiers, @dnd-kit/sortable | Compare with AppShell menus before adopting |
| `dashboard-ui/empty-state` | 22 | 0 free / 22 pro | Empty/denied/no-results states | empty-state7, empty-state2, empty-state1 | sonner, recharts | Harvest already has ui/empty; use as layout reference |
| `dashboard-ui/form-layouts` | 22 | 0 free / 22 pro | Settings, forms/surveys builder chrome, wizards | form-layout1, form-layout15, form-layout11, form-layout20 | @hookform/resolvers, react-hook-form, zod | React Hook Form + zod 3 in source; Harvest has neither |
| `dashboard-ui/modal-dialogs` | 28 | 1 free / 27 pro | Dialog patterns (share/invite/members/consent/plans) | dashboard-modal4, dashboard-modal17, dashboard-modal24, dashboard-modal10 | valibot, @formisch/react, qrcode.react | Pattern reference |
| `dashboard-ui/onboarding-screens` | 10 | 0 free / 10 pro | Onboarding, creation wizards | onboarding-screen4, onboarding-screen9, onboarding-screen10, onboarding-screen3 | @shadcn/react, cn | Screen 4 mirrors audience-adaptive questions |
| `dashboard-ui/page-layouts` | 3 | 0 free / 3 pro | Page templates, top-nav public/member layouts | dashboard-page-layout1, dashboard-page-layout2 | next-themes | Layout frames only |
| `dashboard-ui/sidebar-layouts` | 1 | 0 free / 1 pro | App shell | sidebar-layout | none | Stock sidebar anatomy; no new value over ui/sidebar |
| `dashboard-ui/sign-in-forms` | 3 | 1 free / 2 pro | Auth | signin-form1 | none | Harvest uses email-code sign-in; low value |
| `dashboard-ui/stat-cards` | 33 | 1 free / 32 pro | Dashboards/home, campaign and community stats | stat-card1, stat-card12, stat-card28 | recharts | Real metrics only |
| `dashboard-ui/tables` | 25 | 7 free / 18 pro | CRM People/Organizations, members, communities, content calendar | tables19, tables5, tables9, tables14, tables21 | @tanstack/react-table | tables1-7 are free; the rest premium |

## application-ui (70)

| Category | Items | Free | Harvest module | Top candidates | Extra npm packages | Note |
| --- | ---: | --- | --- | --- | --- | --- |
| `application-ui/ai-chat` | 21 | 1 free / 20 pro | Not launch scope (AI assistants are post-launch) | ai-chat1 | ai, nanoid, sonner | ai SDK + prompt-input |
| `application-ui/chat-ui` | 10 | 0 free / 10 pro | Unified social inbox, Connect follow-up queue, community chat/DM | chat-ui10, chat-ui4, chat-ui5, chat-ui6 | sonner, @shadcn/react | Presentation only; channel capabilities stay in the Harvest integration layer |
| `application-ui/event-calendar` | 4 | 0 free / 4 pro | Social scheduler calendar, events, community events | event-calendar1, event-calendar2 | sonner, @dnd-kit/utilities | Month/week/day/agenda + drag reschedule |
| `application-ui/gantt-chart` | 3 | 0 free / 3 pro | Campaign timeline (later) | gantt-chart1 | @dnd-kit/modifiers, jotai, lodash.throttle | Post-launch |
| `application-ui/kanban-board` | 7 | 0 free / 7 pro | CRM deals board, campaign task boards | kanban-board3, kanban-board1, kanban-board6 | @dnd-kit/utilities, @dnd-kit/sortable, tunnel-rat | Harvest deal-board already has accessible dnd-kit moves; reference only |
| `application-ui/mail-app` | 8 | 0 free / 8 pro | Inbox list/reader patterns | mail-app4, mail-app6, mail-app1 | sonner, zustand, react-resizable-panels | Not an email product; patterns only |
| `application-ui/map-view` | 11 | 0 free / 11 pro | Campaign event locations (later) | map-view7 | maplibre-gl, recharts | maplibre-gl, heavy; defer |
| `application-ui/todo-app` | 6 | 1 free / 5 pro | CRM tasks, follow-up work queue | todo-app5, todo-app6, todo-app2 | sonner, @dnd-kit/utilities, @dnd-kit/modifiers | Task drawer + timeline |

## ecommerce (59)

| Category | Items | Free | Harvest module | Top candidates | Extra npm packages | Note |
| --- | ---: | --- | --- | --- | --- | --- |
| `ecommerce/checkout-page` | 5 | 0 free / 5 pro | Checkout/delivery UI | checkout1, checkout2 | zod, react-hook-form, @hookform/resolvers | No card-field collection in Harvest UI; hosted provider fields only |
| `ecommerce/customer-reviews` | 9 | 0 free / 9 pro | Course/product reviews | customer-reviews* | none |  |
| `ecommerce/product-cards` | 11 | 0 free / 11 pro | Courses/products cards, Discover results | product-card* | none | Rebuild with Harvest data |
| `ecommerce/product-category` | 9 | 0 free / 9 pro | Discover category tiles | product-category* | none |  |
| `ecommerce/product-details` | 7 | 0 free / 7 pro | Product/course detail page | product-details1, product-details6 | none |  |
| `ecommerce/product-features` | 2 | 0 free / 2 pro | Product/course detail sections | product-features* | none |  |
| `ecommerce/product-list` | 8 | 0 free / 8 pro | Courses/products catalog, Discover | product-list3, product-list7 | none |  |
| `ecommerce/product-quickviews` | 2 | 0 free / 2 pro | Discover quick view | product-quickview* | none |  |
| `ecommerce/promo-sections` | 1 | 0 free / 1 pro | Public pages | promo* | react-use-measure, motion | Low |
| `ecommerce/shopping-cart` | 4 | 0 free / 4 pro | Checkout (cart summary) | shopping-cart* | zustand | Provider undecided: UI only |
| `ecommerce/store-navigation` | 1 | 0 free / 1 pro | Public storefront nav (post-launch) | store-navigation* | none | Community storefronts are post-launch |

## marketing (190)

| Category | Items | Free | Harvest module | Top candidates | Extra npm packages | Note |
| --- | ---: | --- | --- | --- | --- | --- |
| `marketing/changelog-page` | 4 | 0 free / 4 pro | Public changelog | changelog* | none |  |
| `marketing/contact-us` | 13 | 0 free / 13 pro | Public pages | contact* | @hookform/resolvers, react-hook-form, zod |  |
| `marketing/cta-sections` | 12 | 0 free / 12 pro | Public pages | cta* | none |  |
| `marketing/faqs` | 10 | 1 free / 9 pro | Public/help pages | faq1 | none |  |
| `marketing/feature-sections` | 13 | 0 free / 13 pro | Public pages | feature* | embla-carousel-autoplay |  |
| `marketing/footers` | 12 | 0 free / 12 pro | Public footer | footer* | none |  |
| `marketing/hero-sections` | 26 | 1 free / 25 pro | Public/marketing pages | hero1 | motion, recharts, react-use-measure | Public site only |
| `marketing/how-it-works` | 11 | 1 free / 10 pro | Public pages | how-it-works9 | none |  |
| `marketing/integrations` | 7 | 0 free / 7 pro | Public pages | integrations* | motion, react-use-measure | Brand logos |
| `marketing/navbars` | 15 | 0 free / 15 pro | Public nav | navbar* | none |  |
| `marketing/newsletter-sections` | 8 | 2 free / 6 pro | Public pages (subscribe forms need consent gate) | newsletter1 | none | Any sign-up must call the consent flow |
| `marketing/pricing-tables` | 20 | 0 free / 20 pro | Billing plans, community/course pricing | pricing1, pricing14 | none | Dodo billing UI stays Harvest-owned |
| `marketing/stats` | 12 | 0 free / 12 pro | Public pages | stats* | recharts |  |
| `marketing/team-sections` | 12 | 0 free / 12 pro | Public pages | team* | none |  |
| `marketing/testimonials` | 15 | 0 free / 15 pro | Public pages | testimonial* | motion, embla-carousel-autoplay |  |

## examples (70)

| Category | Items | Free | Harvest module | Top candidates | Extra npm packages | Note |
| --- | ---: | --- | --- | --- | --- | --- |
| `cards` | 44 | 10 free / 34 pro | Small card patterns (stat, task, welcome, payment methods, social post) | task-card1, social-media-post1 | recharts | Review cards: 10 free |
| `charts` | 10 | 0 free / 10 pro | Chart examples |  | recharts | recharts |
| `date-picker` | 4 | 4 free / 0 pro | Scheduler/date fields | date-picker-example1..4 | none | Free |
| `dropdown-menu` | 2 | 0 free / 2 pro | Account menus | user-menu* | none |  |
| `form` | 6 | 0 free / 6 pro | Auth forms | authentication-form1 | @hookform/resolvers, react-hook-form, zod | Harvest uses email code |
| `switch` | 4 | 0 free / 4 pro | Settings/consent permission cards | switch-card1, theme-switcher1 | @hookform/resolvers, react-hook-form, zod | switch-card is the consent/preference row shape |

## illustrations (36)

| Category | Items | Free | Harvest module | Top candidates | Extra npm packages | Note |
| --- | ---: | --- | --- | --- | --- | --- |
| `illustrations` | 36 | 0 free / 36 pro | Empty states/marketing art | illustration* | motion, next-themes, @remixicon/react | Animated; premium; low priority |

## components (567)

| Category | Items | Free | Harvest module | Top candidates | Extra npm packages | Note |
| --- | ---: | --- | --- | --- | --- | --- |
| `accordion` | 12 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `alert` | 15 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `alert-dialog` | 16 | free* | Primitive variant gallery (pattern reference) |  | react-payment-inputs | Stock primitive; see ui/ overlap |
| `attachment` | 5 | free* | Inbox/chat attachments | attachment1..5 | none | Kit-shipped ui/attachment |
| `autocomplete` | 5 | free* | Search fields | autocomplete1..5 | @base-ui/react | Uses @base-ui/react |
| `avatar` | 21 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `badge` | 17 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `breadcrumb` | 6 | free* | Header breadcrumbs | breadcrumb1..6 | none | ui/breadcrumb exists |
| `bubble` | 7 | free* | Inbox/chat message bubbles | bubble1..7 | none | Kit-shipped ui/bubble (radix-ui) |
| `button` | 27 | free* | Primitive variants | button* | @remixicon/react | Variant gallery; Harvest button has 44px responsive sizes the kit lacks |
| `button-group` | 20 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `calendar` | 15 | free* | Date pickers | calendar1..15 | none | react-day-picker already installed |
| `card` | 9 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `carousel` | 13 | free* | Product galleries | carousel* | embla-carousel-autoplay | embla; low |
| `checkbox` | 13 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `code-block` | 18 | free* | Not launch scope | code-block* | shiki | shiki; skip |
| `collapsible` | 8 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `combobox` | 12 | free* | Pickers, filters | combobox1..12 | none | Stock combobox may require base-ui; check per item |
| `command` | 9 | free* | Global command/search | command1, command9 | none | cmdk already installed |
| `context-menu` | 1 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `data-table` | 6 | free* | CRM tables (reference) | data-table1..6 | @tanstack/react-table, @dnd-kit/utilities, @dnd-kit/modifiers | TanStack Table not installed; Harvest lists are server-driven |
| `drawer` | 6 | free* | Mobile sheets | drawer1..6 | none | Stock drawer missing (vaul) |
| `dropdown-menu` | 12 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `empty` | 8 | free* | Empty states | empty1..8 | @tabler/icons-react | ui/empty exists |
| `field` | 10 | free* | Forms | field1..10 | none | Matches ui/field |
| `file-upload` | 10 | free* | Files, avatars, media | file-upload1..10 | none | Drag-and-drop; storage rules stay in Files service |
| `hover-card` | 3 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `input` | 26 | free* | Primitive variants | input* | use-mask-input, react-phone-number-input, react-payment-inputs |  |
| `item` | 10 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `menubar` | 1 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `native-select` | 9 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `navigation-menu` | 4 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `pagination` | 12 | free* | Lists | pagination1..12 | none | ui/pagination exists |
| `popover` | 6 | free* | Primitive variant gallery (pattern reference) |  | @remixicon/react | Stock primitive; see ui/ overlap |
| `progress` | 10 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `radio-group` | 15 | free* | Primitive variant gallery (pattern reference) |  | @remixicon/react | Stock primitive; see ui/ overlap |
| `scroll-area` | 6 | free* | Panels | scroll-area* | none | Stock scroll-area missing |
| `select` | 15 | free* | Primitive variant gallery (pattern reference) |  | @remixicon/react | Stock primitive; see ui/ overlap |
| `separator` | 16 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `sheet` | 8 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `skeleton` | 7 | free* | Loading states | skeleton1..7 | none | ui/skeleton exists |
| `slider` | 13 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `sonner-toast` | 12 | free* | Notifications/toasts | toast1..12 | sonner | No toast system in Harvest today; sonner + theme adapter needed |
| `spinner` | 14 | free* | Loading | spinner1..14 | none | Stock spinner missing in Harvest |
| `stepper` | 14 | free* | Wizards (campaign, community, course) | stepper1..14 | @base-ui/react | Uses @base-ui/react utilities; indicators are 24px |
| `switch` | 10 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `table` | 12 | free* | Tables | table1..12 | none | ui/table variants |
| `tabs` | 15 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `textarea` | 11 | free* | Primitive variant gallery (pattern reference) |  | @hookform/resolvers, react-hook-form, zod | Stock primitive; see ui/ overlap |
| `toast` | 1 | free* | Primitive variant gallery (pattern reference) |  | sonner | Stock primitive; see ui/ overlap |
| `toggle` | 8 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |
| `tooltip` | 8 | free* | Primitive variant gallery (pattern reference) |  | none | Stock primitive; see ui/ overlap |


## Measured compatibility with Harvest (whole registry)

Measured on 16 Nov 2026 by scanning all 1228 downloaded items (kept outside the repo). "Harvest guard" means `inspectSource` from `scripts/source-guards.ts` run over each item's source, so the numbers are what `npm run lint` would report if the item were dropped in unchanged.

| Measure | Items | Share |
| --- | ---: | ---: |
| Fail the i18n guard (hard-coded JSX copy or error strings) | 1143 | 93% |
| Fail the color guard (raw palette classes, hex or oklch) | 370 | 30% |
| Pass both guards unchanged | 66 | 5% |
| Need only stock primitives Harvest already has in `src/components/ui` | 845 | 69% |
| Need no npm package beyond Harvest's current set | 866 | 71% |
| Need `recharts` (chart blocks) | 82 | 7% |
| Need `react-hook-form` and a zod resolver | 41 | 3% |
| Need `@tanstack/react-table` | 25 | 2% |
| Need `motion` | 56 | 5% |
| Need `maplibre-gl` | 16 | 1% |
| Need `shiki` (code blocks) | 18 | 1% |
| Need `@base-ui/react` (steppers, autocomplete, two blocks) | 22 | 2% |
| Import brand icons that lucide-react 1.68 no longer exports | 25 | 2% |
| Mention the vendor's name or logo URL in source | 52 | 4% |
| Use raw color-palette classes (`bg-green-500` and similar) | 289 | 24% |
| Use button sizes below 44px on phones (`sm`, `icon-sm`, `icon-xs`, `xs`) | 349 | 28% |

About 344 source lines load sample photos or avatars from third-party hosts (mainly `i.pravatar.cc` and `images.unsplash.com`).

Missing stock primitives (items that need them): `toggle-group` 82, `chart` 82, `scroll-area` 75, `drawer` 66, `spinner` 62, `sonner` 45, `accordion` 30, `carousel` 27, `hover-card` 24, `navigation-menu` 23, `slider` 21, `toggle` 21, `use-mobile` 13, `kbd` 12, `context-menu` 4, `combobox` 3, `menubar` 1.

The kit ships 23 files of its own under `components/ui` (`attachment`, `attachments`, `autocomplete`, `bubble`, `code-block`, `code-block-highlight`, `conversation`, `form`, `gantt`, `infinite-slider`, `kanban`, `light-rays`, `map`, `message`, `message-scroller`, `model-selector`, `prompt-input`, `questionnaire`, `resizable`, `shimmer`, `star-rating`, `stepper`, `suggestion`). None has the same filename as a file in Harvest's `src/components/ui`.

Preview links: `https://shadcnuikit.com` + the item's registry `href` + `#` + the item name with a hyphen before its trailing number (`tables19` is `/blocks/dashboard-ui/tables#tables-19`, `chat-ui10` is `/blocks/application-ui/chat-ui#chat-ui-10`). One registry entry, `toast-component1`, has an `href` (`/components/toast`) that returns 404.
