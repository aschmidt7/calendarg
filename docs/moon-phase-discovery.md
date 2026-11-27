# Moon-Phase Support — Discovery Report (Issue #14)

Calendarg Iteration 2, first activity. Report only: no implementation in this issue.

## Decisions (user-approved)

1. **Data source: local astronomical calculation.** No network, no API, no provenance chain.
   The phase is computed by a pure deterministic domain function.
2. **Timezone: Argentina (UTC-3).** A phase instant is assigned to the local date by
   subtracting the fixed offset. Argentina has had no DST since 2009, so a fixed `-03:00`
   offset is correct year-round and avoids a runtime `Intl` time-zone dependency.
3. **Phases: the 4 primary phases only** — new, first quarter, full, last quarter.
   Intermediate crescent/gibbous phases are out of scope.
4. **Visual: the classic black-and-white circle glyph** — geometric shape, not text.

## Data-source policy

- Recommended algorithm: Meeus's lunar phase (chapter 49) with the truncated correction
  series. Accuracy within minutes of the true instant, well below the calendar-day
  granularity, without external tables. A pure mean-synodic model (29.53059-day period)
  was rejected: its worst-case error approaches ±0.6 days, which can place a phase on the
  wrong printed day near local-midnight boundaries.
- The calculation is a pure function of the UTC-3 calendar month. Same inputs → same
  phases, byte-identical output. Satisfies the existing determinism contract.
- Validation requirement: the implementation must be tested against published almanac
  dates for a representative window (e.g. 2024–2026) so boundary cases are pinned.

## Domain and date semantics

- Domain model: `MoonPhase = "new" | "first-quarter" | "full" | "last-quarter"`, one
  optional phase per calendar date. A date hosting zero primary phases stays empty.
- One date can host at most one primary phase (guaranteed by construction: crossings are
  ~7.38 days apart).
- Semantics are date-granular: the printed glyph means "this phase falls on this Argentine
  calendar date". No time-of-day is printed.

## Visual representation

| Phase | Glyph |
| --- | --- |
| New | Outlined circle (unfilled) |
| First quarter | Circle with right half filled |
| Full | Solid filled circle |
| Last quarter | Circle with left half filled |

- Glyph diameter: 3,000 µm (3 mm outline diameter; filled area slightly smaller due to the
  300 µm stroke used across the document).
- Placement: right end of the day-number annotation band (y 1,500–6,000 from cell top),
  vertically centered in the band. The day-number text is anchored `start` (measured:
  `src/rendering/layout-ir.ts`, day number uses `textAnchor: "start"`), so the left-anchored
  numeral and a right-anchored glyph never overlap for any cell width.
- No text label is printed next to the glyph.

## Impact on the protected handwriting region: none

Measured against the current fixed policy (`src/domain/writable-regions.ts`,
`WRITABLE_REGION_POLICY`, version `1.0.0-proposed`):

- Cell geometry (5-row months): 27,142 µm wide (190,000/7) × 52,800 µm tall
  (264,000/5). Six-row months: 44,000 µm tall.
- The day-number band is 4,500 µm tall; a 3,000 µm glyph centered in it leaves 750 µm
  above and below.
- The glyph ends at the same horizontal inset (1,500 µm) as the annotation boxes.
- The protected writable region starts at y = 15,500 µm from cell top and is untouched:
  **0 µm reduction in protected height, width, or area.**
  The protected-region minimums (`PROTECTED_WRITABLE_REGION_MINIMUMS_UM`) remain valid
  unchanged, including 6-row months.
- The annotation gap band (14,000–15,500 µm) is also untouched.

## Renderer impact (restricted SVG contract)

The current restricted SVG grammar (`src/rendering/svg.ts`) admits exactly `<rect>`
(outline) and `<text>` primitives. The classic glyph requires:

1. A new `<circle>` primitive (outline + optional fill) in the restricted grammar.
2. A bounded representation for the half-filled quarter glyphs — recommended as a second
   canonical `<path>` (half-disc), or equivalently a semicircle primitive, so the grammar
   stays closed and regex-verifiable. Arbitrary path data must not be admitted.

Both are renderer-layer extensions; the canonical layout IR gains one new text-free
element role (e.g. `moon-marker`, currently rejected as an illegal role in
`test/layout-ir.test.ts`) carrying the phase and its box, keeping PDF semantics
renderer-independent.

## Local/offline behavior and provenance

- Fully offline by construction. No request, cache, freshness policy, or provenance
  metadata exists for a computed value.
- The generator remains runnable in the current sandbox with no new network surface.
- Additive provenance note in generation diagnostics is unnecessary; the computation is
  reproducible from the source code itself.

## Supported / unsupported behavior (proposed)

**Supported**
- One glyph per date for each of the 4 primary moon phases, computed locally in UTC-3.
- All supported months (years accepted by the existing Gregorian bounds).
- Zero layout-policy change: protected regions identical to v1.
- Deterministic output; recomputation is free.

**Unsupported (explicit)**
- Intermediate phases (waxing/waning crescent and gibbous, quarters between primaries).
- Time-of-day display for a phase.
- Custom glyph placement, size, or style.
- Hemisphere-adjusted quarter orientation is fixed to the southern-hemisphere convention
  (first quarter: waxing lit on the left? — to be pinned against Argentine almanac
  conventions during implementation testing).
- Moon-rise/set events, eclipse indications, or lunar zodiac data.

## Recommendation

**Implement.** With a right-side 3 mm glyph in the existing day-number band, moon phases
add calendar information without touching the protected handwriting region — the core
handwriting-first product goal is unaffected. The residual risks are (a) the restricted
SVG grammar extension and (b) algorithm accuracy near local-midnight boundaries, both
addressable by the test plan above.

## Proposed spec slice (if approved)

1. Domain: pure `MoonPhase` calculation (Meeus truncated), UTC-3 date mapping, almanac
   regression fixtures for 2024–2026 (new issue: `status:approved`, `type:feature`).
2. Application: monthly model carries optional phase per current-date cell.
3. IR: new `moon-marker` role with phase + box; validation keeps rejecting everything
   outside the new contract.
4. Renderer: restricted SVG gains `circle` + bounded half-disc; PDF inspection test pins
   glyph presence and non-overlap with the numeral bounding box.
5. Layout evidence: regenerate release PDF evidence and re-run the HP LaserJet 1020 print
   check for legibility of a 3 mm glyph.
