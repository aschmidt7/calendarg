# Moon-Phase Implementation Evidence (Issue #18)

Implementation of the four primary moon phases per `docs/moon-phase-discovery.md`
and GitHub issue #18. Branch `feat/moon-phases`.

## Implementation evidence

- Domain calculation: `src/domain/moon.ts` — Meeus, "Astronomical Algorithms"
  (2nd ed.) chapter 49 truncated series (25 correction terms + 14 planetary
  terms), pure function, no network, fixed Argentina UTC-3 date mapping.
- Regression fixtures: **149 events** (2024: 50, 2025: 49, 2026: 50) from the
  Servicio de Hidrografía Naval official tables (Hora Oficial Argentina).
  Validated by 9 eclipse anchors (solar eclipses = new moon; lunar eclipses =
  full moon) and lunar-cycle gap continuity (6–9 days between consecutive
  primaries). Fixture: `test/moon.test.ts`.
- Application model: current-month cells carry `moonPhase`; adjacent-month
  cells never do. `src/domain/month.ts`, `src/application/generate.ts`.
- Canonical IR: `LayoutShape` with `moon-marker` role, 3,000 µm bounding box,
  validated shape/phase/fillSide consistency, must sit inside its cell's
  day-number band (y 1,500–6,000 µm from cell top) and never overlap a
  protected writable region. `src/rendering/layout-ir.ts`.
- Restricted SVG: bounded `<circle>` (outlined = new, solid = full) and
  half-disc `<path>` (first quarter fills left, last quarter fills right;
  southern-hemisphere view, verified against the official SHN phase icons,
  closing advisory R3-001 of the native review). Quarter glyphs additionally
  carry a full outline ring (chosen from 5 rendered design options by the
  user for print legibility at 3 mm: option A, ring + filled half). Arbitrary path data and non-1,500 µm radii
  are rejected. `src/rendering/svg.ts`.

## Protected handwriting region: unchanged

The glyph box (3,000 µm) is centered vertically in the day-number annotation
band (4,500 µm tall, y 1,500–6,000 µm from the cell top). The protected
writable region starts at y = 15,500 µm; `WRITABLE_REGION_POLICY` and
`PROTECTED_WRITABLE_REGION_MINIMUMS_UM` are untouched. IR validation enforces
marker/protected-region disjointness per cell.

## Test suite evidence

- Full suite at implementation close: **115 passing tests** (v1 baseline: 67;
  post-PR #17: 101). New tests: 7 domain, 2 month model, 3 layout IR,
  2 restricted SVG.
- `npm run verify` (typecheck + tests + release-check): exit 0.

## Real-renderer PDF evidence

- May 2024 (five primary phases) rendered through the real local toolchain
  (`rsvg-convert` + Poppler inspection) inside `test/real-renderer.test.ts`:
  2 circle glyphs + 3 half-disc glyphs serialized; PDF text layer unchanged
  (glyphs are vector shapes, not text; no phase names leak into the text
  layer); pdffonts shows the same embedded DejaVu Sans.
- Regenerated evidence artifact (retained locally, `evidence/output/` is
  gitignored): `monthly-calendar-2024-05-moonphases.pdf`,
  SHA-256 `8baeda62920a34d78e8f184253ceaa86c54c969f7b40b669ef10c8e5f9c26520`,
  1 A4 portrait page, 11,052 bytes. Visually verified (rendered to PNG with
  pdftoppm): new moon is an outlined empty disc, full moon a solid disc, and
  the quarter glyphs fill the correct half per the SHN convention. Previous
  artifact SHA-256 `bf5b70e3...` had the SVG default-fill defect where the
  new-moon circle rendered solid (identical to the full moon), reported by
  the user during the physical print review.

## Physical print evidence (pending)

The 3 mm glyph legibility check on the reference HP LaserJet 1020 (A4
portrait, Actual size, fit-to-page disabled) is **pending manual validation**:
it requires physical access to the printer. The v1 10 mm safe-area calibration
(`evidence/printer-calibration.md`) is unaffected because the glyph lives
inside the existing annotation band.

## Commit trail

- `e5c496f` feat(domain): moon-phase calculation + SHN fixtures (S1–S4)
- `16bf927` feat(application): optional moon phase in monthly cells (S5)
- `a1407c2` feat(rendering): moon-marker IR role + bounded SVG glyphs (S6–S7)
- PDF inspection pin + this evidence file (S8–S9)
