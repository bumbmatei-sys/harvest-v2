# Kit PR 0 — Tooling and provenance: acceptance record

Plan: `docs/plans/shadcnuikit-adoption.md` section 7, row PR 0.

## What changed

- `components.json`: `@shadcnuikit` registry entry with the `Bearer ${REGISTRY_TOKEN}` placeholder only. `.env.example`: `REGISTRY_TOKEN=` (no value). `.gitignore` already ignores real `.env*` files.
- Provenance: `src/lib/ui-provenance.ts` (schema, validator, header reader, empty `kitProvenance`), a "Shadcn UI Kit provenance" section in `docs/ui-sources.md` with the header rule and agent-session registry usage.
- Token-leak guard: pure scanner `src/lib/secret-scan.ts`; `tests/unit/ui-provenance.test.ts` validates the schema, checks listed files exist and carry the header, finds headered files missing from the record, scans every tracked text file, and proves the scanner on synthetic strings.
- Chart tokens `--chart-1..5` for harvest and studio, light and dark, wired as `bg-chart-N` in `globals.css`; each at least 3:1 against `--surface-card` and `--surface` (lowest measured 4.33), tested in `tests/unit/theme.test.ts`.
- `/dev/ui`: new "Kit-derived items" group (registered in `src/lib/ui-showcase.ts`, copy in `messages/en.json`) showing the empty state and the five swatches of the current theme; e2e extended.

## Not done

- No kit item adopted, so the founder item-approval gate had nothing to approve. No kit source, registry JSON, downloaded block or token is in the repository; no registry command was run and CI is unchanged.
- No new npm dependency; no chart component (recharts comes with its first consumer).
- The 12 future palettes are not in the registry, so they have no chart tokens yet.
- Registry URL pattern was not probed with the credential.
