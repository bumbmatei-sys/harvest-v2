# Requested Harvest themes

Founder selections, 8 November 2026. Add these as selectable palettes through the existing theme registry during Phase 0A; this document records requested work, not installed themes. The official default remains undecided. Honey Glow Gold is a candidate for the official Harvest theme, not an approved replacement.

| Requested theme | Source |
| --- | --- |
| Claude | https://21st.dev/@serafimcloud/themes/claude |
| Sage Garden | https://21st.dev/@serafimcloud/themes/sage-garden |
| Amber Slate | https://21st.dev/@serafimcloud/themes/amber-slate |
| Supabase | https://21st.dev/@serafimcloud/themes/supabase |
| Indigo Mono | https://21st.dev/@serafimcloud/themes/indigo-mono |
| Amber Hearth | https://21st.dev/@serafimcloud/themes/amber-hearth |
| Darkmatter | https://21st.dev/@serafimcloud/themes/darkmatter |
| Meridian Blue | https://21st.dev/@serafimcloud/themes/meridian-blue |
| Discord Linen | https://21st.dev/@serafimcloud/themes/discord-linen |
| Honey Glow | https://21st.dev/@serafimcloud/themes/honey-glow |
| Honey Glow Gold — possible official Harvest default | https://21st.dev/@serafimcloud/themes/honey-glow-gold |
| Taranom Emerald Gold | https://21st.dev/@rashidhamedas/themes/taranom-emerald-gold-1784716637053 |

URLs are preserved as supplied; display names normalize the founder's shorthand. Validate source metadata before importing. Public text retrieval confirmed Sage Garden exposes light/dark shadcn tokens; Honey Glow Gold and Taranom returned retrieval errors in the browsing tool, so their token contents and availability are not certified here. No source license or contrast approval is inferred from a gallery listing.

## Implementation checklist

- [ ] Retrieve each exact palette's full token definitions and source/license evidence; record provenance before importing.
- [ ] Map light/dark tokens into `src/lib/theme-registry.ts`, including shell/sidebar, fields, cards, text, borders, actions, focus, errors and charts where used. Do not paste competing global stylesheets over the application.
- [ ] Keep palette, light/dark mode and typography/layout conventions separate. Reuse the existing picker/persistence architecture and migrate saved preferences compatibly.
- [ ] Present one searchable theme picker with previews; do not add twelve separate controls. Keep names concise, with no explanatory paragraph for each option.
- [ ] Preview every palette on the same CRM list/filter, contact detail, QR editor and public landing, in both modes and mobile/tablet/desktop. Fix contrast, focus and disabled/error/paid/free distinctions before offering it.
- [ ] Reconcile the existing Harvest gold-action decision explicitly with colored palette accents; do not silently override brand policy or collapse every palette into identical accents.
- [ ] Obtain Matei's choice before changing the official default, renaming a third-party reference as Harvest or removing existing Harvest/Studio choices. This does not require approval for routine implementation/testing of the requested selectable palettes.

## Existing free UI/resource references

The repository already lists [shadcn official blocks](https://ui.shadcn.com/blocks), [Astryx templates](https://astryx.atmeta.com/templates) and [Astryx source](https://github.com/meta/astryx) in [master PRD §13](../prd/PRD-v2.5.md). [Companion PRD §31](../prd/PRD-v2.7-companion.md) requires exact-component license checks. Eden, Twenty and Postiz are also referenced for UX/architecture, with explicit reuse restrictions; they are not blanket free-code sources. The supplied [ReUI filter reference](https://reui.io/components/filters/c-filters-10) remains the CRM interaction reference.

A paid 21st.dev plan is not established as a prerequisite. Check actual access to the requested source tokens before recommending a purchase.
