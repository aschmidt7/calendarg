# Feature: Moon phases (4 primary phases, local calculation)

Spec: GitHub issue #18 (approved). Discovery: `docs/moon-phase-discovery.md`. Branch: `feat/moon-phases`.

## Specs

- S1: A pure domain calculation (`src/domain/moon.ts`) computes, for a requested month in Argentina fixed UTC-3, the calendar date of each primary phase: new, first quarter, full, last quarter. Only these 4 phases are supported; intermediate phases are out of scope.
- S2: The calculation is deterministic (same inputs → identical dates) and uses no network access.
- S3: Phase dates are pinned against published Argentine almanac data for 2024, 2025 and 2026 (regression fixtures in tests).
- S4: A phase instant near local midnight is assigned to the correct Argentine calendar date under the fixed `-03:00` offset.
- S5: The monthly calendar model (application layer) carries the optional moon phase for each current-month cell; zero or one phase per date.
- S6: The canonical layout IR admits a new `moon-marker` role carrying the phase and its box; validation rejects any role outside the defined contract (existing illegal-role rejection stays green).
- S7: The restricted SVG grammar admits a bounded `<circle>` primitive for new/full phases and a bounded half-disc representation for quarter phases; arbitrary path data is rejected. Quarters use southern-hemisphere orientation pinned in S3 evidence.
- S8: PDF output contains the glyph for each phase date, and the glyph box never intersects the day-number text box. Protected writable regions remain identical to v1 (zero area reduction).
- S9: Release evidence (PDF SHA, inspection output) is regenerated showing glyphs; a real-print check on the reference printer documents 3 mm glyph legibility.

## Tasks

- T1 (S3,S1,S4): Almanac fixtures 2024–2026 + UTC-3 mapping tests (RED first). Commit: feat(domain)
- T2 (S1,S2,S4): Implement `src/domain/moon.ts` Meeus truncated, 4 phases, deterministic. Commit: feat(domain) — same commit as T1
- T3 (S5): Application/application monthly model optional phase per cell + tests. Commit: feat(application)
- T4 (S6): IR `moon-marker` role + validation, keep illegal-role tests green. Commit: feat(rendering)
- T5 (S7): Restricted SVG circle + bounded half-disc + grammar rejection tests. Commit: feat(rendering) — same commit as T4
- T6 (S8): PDF inspection pin (glyph presence, non-overlap) + fixtures. Commit: feat(rendering)
- T7 (S9): Regenerate release evidence + printer legibility note. Commit: chore(evidence)

## Log

- L1 (user request, 2026-11-27): "quiro arrancar la iteracion 2, revisemos el requerimiento y contame que idea teniamos de como implementarlo" — started Iteration 2 with issue #14 moon-phase discovery.
- L2 (user decision): "si, vamos con el calculo local, el uso horario de Argentina, solo 4 fases, el clasico circulo blanco/negro" — pinned data source, timezone, phase set, visual glyph.
- L3 (user decision): "perfecto avancemos" — approved discovery report; created issue #18 and this feature document.
- L4 (evidence, 2026-11-27): T1+T2 done. Almanac fixtures sourced from SHN official tables (149 events 2024–2026, Hora Oficial Argentina), validated by 9 eclipse anchors and lunar-cycle gap continuity; initial hand-transcribed fixture table (50 events) discarded after month-column alignment analysis. RED→GREEN: src/domain/moon.ts (Meeus ch. 49 truncated, fixed UTC-3 mapping). Root bug fixed during GREEN: month window anchored to JD noon, not local midnight. `npm run verify` exit 0 (108 tests, typecheck, release-check). Commit `e5c496f feat(domain): add primary moon-phase calculation with SHN fixtures` (S1, S2, S3, S4, T1, T2 evidence).
- L5 (evidence, 2026-11-27): T3 done. `buildMonthlyCalendar` takes moon occurrences (third arg); current-month cells carry `moonPhase`, adjacent never do; invalid occurrences rejected. `generate.ts` derives phases for the requested month. Commit `16bf927`.
- L6 (evidence, 2026-11-27): T4+T5 done. IR: `LayoutShape`/`moon-marker` role (3000 um box, shape/phase/fillSide consistency validated, must sit in the day-number band of its cell, never overlapping protected regions; canonical order = right after the day number). SVG: bounded `<circle>` and half-disc `<path>` grammar (r=1500 only, fixed half-disc geometry, arbitrary path data rejected). Southern-hemisphere orientation: first-quarter fills right, last-quarter fills left. `npm run verify` exit 0 (115 tests). Commit `a1407c2`.
- L7 (evidence, 2026-11-27): T6+T7 done. Real-renderer test pins 2 circles + 3 half-discs for May 2024 and an unchanged PDF text layer. evidence/moon-phases.md records SHA-256 bf5b70e3... of the regenerated artifact; physical print check on HP LaserJet 1020 remains pending (manual). Commits `7b9d772`. All S1-S9 satisfied except the physical print item of S9 (pending, manual).
