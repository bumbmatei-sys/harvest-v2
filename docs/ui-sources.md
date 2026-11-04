# UI source register — PR 01a

Owner: Harvest v2 maintainers. Reviewed 2026-11-04. No AGPL source, competitor application code, logos, copy or imagery is included in the product.

| Source | Version/date | License | Dependencies | Changed files | Adaptations |
| --- | --- | --- | --- | --- | --- |
| [shadcn Button registry](https://ui.shadcn.com/r/styles/new-york-v4/button.json) | New York v4 registry, retrieved 2026-11-04 | MIT | React, Radix Slot, class-variance-authority, clsx, tailwind-merge | `src/components/ui/button.tsx` | Local utility alias; individual Radix package import |
| [shadcn Input registry](https://ui.shadcn.com/r/styles/new-york-v4/input.json) | New York v4 registry, retrieved 2026-11-04 | MIT | React, clsx, tailwind-merge | `src/components/ui/input.tsx` | Local utility alias |
| [shadcn Label registry](https://ui.shadcn.com/r/styles/new-york-v4/label.json) | New York v4 registry, retrieved 2026-11-04 | MIT | React, Radix Label, clsx, tailwind-merge | `src/components/ui/label.tsx` | Local utility alias; individual Radix package import |
| [shadcn Card registry](https://ui.shadcn.com/r/styles/new-york-v4/card.json) | New York v4 registry, retrieved 2026-11-04 | MIT | React, clsx, tailwind-merge | `src/components/ui/card.tsx` | Local utility alias |
| [shadcn Alert registry](https://ui.shadcn.com/r/styles/new-york-v4/alert.json) | New York v4 registry, retrieved 2026-11-04 | MIT | React, class-variance-authority, clsx, tailwind-merge | `src/components/ui/alert.tsx` | Local utility alias |
| [Geist fonts](https://github.com/vercel/geist-font) | npm geist 1.9.0 (package-lock.json) | OFL-1.1 | next/font/local | `src/app/layout.tsx`, `src/app/globals.css` | Self-hosted sans font; no runtime Google Fonts request |
| Harvest-owned forms and screen composition | 2026-11-04 | Private repository code | shadcn primitives above, Better Auth client, Next App Router | `src/app/sign-in/page.tsx`, `src/app/workspaces/*`, `src/components/workspace-form.tsx` | Original content and composition |
| [Local design specification](design/DESIGN.md), local reference screenshots, read-only v1 `docs/prd/screenshots/16-ui-system` | 2026-11-04 | Visual reference only; no imported application source/assets | None | `src/app/globals.css`, sign-in typography and spacing | Neutral surface/text tokens, 10px controls, 16px cards, Geist and restrained layout; Harvest gold with dark text |

The full selectable theme system, sidebar shell and contacts are deferred to PR 01b. This foundation uses CSS variables for primitives so those additions do not require brand-specific conditionals. MIT and OFL notices are preserved under `docs/licenses/`; the full dependency inventory is in [third-party-licenses.md](third-party-licenses.md).
