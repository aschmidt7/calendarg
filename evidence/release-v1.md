# v1 Release-Boundary Evidence Record

**Purpose:** Define the implemented v1 boundary and preserve the evidence and
limitations that apply to this release candidate. This is an evidence record,
not a claim of a universal printing or external-service guarantee.

## Implemented v1 scope

v1 implements one vertical monthly calendar template with one A4 sheet per
month. The calendar grid is Monday-first and uses Spanish labels.

Holiday data is limited to Argentine national holidays classified as
`inamovible` or `trasladable`. The generator reads local JSON first and uses
ArgentinaDatos only as a fallback. `puente` holidays are explicitly excluded.

The output contract includes protected writable regions, restricted SVG input,
PDF generation through `rsvg-convert`, and a local CLI. Generation remains
usable offline in degraded mode when fallback data is unavailable.

The following are intentionally outside v1:

- editor functionality;
- moon phases;
- additional templates; and
- cloud or backend services.

## Product and integration evidence

- Product suite: **67 passing tests**.
- Integration: real local `rsvg-convert` and Poppler integration exercised.
- Current regenerated product artifact: `evidence/output/v1-test-may-2024.pdf`.
  Current SHA-256: `67120e0d2d36c9a0f9a14827c68441017c311dc20fd1e1f41efba5963f6e43c1`.
- Physically printed calibration artifact: `evidence/output/monthly-calendar-2024-05.pdf`.
  Printed-artifact SHA-256: `fe79122eaeedc522336cd092033779d00c203c055b56c4643b603565c3be2946`.

## Physical print evidence

**Result: PASS — printer-scoped only.** Physical printing was verified on an
HP LaserJet 1020 using this driver path:

```text
USBPRINT\\HEWLETT-PACKARDHP_LASERJET_1020\\6&29F2C618&0&USB001
```

The verified print settings were A4 portrait, **Actual size**, with
fit-to-page disabled. Measured output was:

| Measurement | Observed value |
| --- | ---: |
| Margins (left/right/bottom) | 11 / 9 / 8 mm |
| Top-to-grid distance | 24 mm |
| Title distance | 12 mm |
| Calendar cell size | approximately 27 x 53 mm |

The 10 mm safe area is **experimental and printer-scoped**. The top-grid and
title measurements above are observed measurements for this setup, not
universal layout guarantees. This record makes no universal printer,
driver, paper-handling, scaling, or margin claim.

## Data-source caveats

ArgentinaDatos is a fallback convenience source, not an official government
authority. Its licensing terms and service availability must be assessed by
the consumer at use time. Local JSON remains the primary source so the
product can generate calendars in offline degraded mode; fallback failure
must not be interpreted as confirmation that the local holiday data is
current or authoritative.

## Remaining release risks

- Holiday completeness and classification depend on the maintained local JSON
  and, when used, the availability and semantics of ArgentinaDatos.
- ArgentinaDatos may change, be unavailable, impose license obligations, or
  differ from official publications.
- The SVG-to-PDF path depends on locally installed `rsvg-convert` and Poppler
  behavior; platform and version differences may affect output.
- Print geometry, including the experimental 10 mm safe area, remains
  dependent on the tested printer, driver, media, and disabled scaling.
- Offline generation can proceed in degraded mode, but cannot obtain fallback
  holiday data while offline.

## Iteration 2 order

Iteration 2 must proceed in this order:

1. moon-phase discovery;
2. additional templates; then
3. editing.
