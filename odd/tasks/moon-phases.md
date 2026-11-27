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
