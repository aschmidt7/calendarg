# Changelog

All notable Calendarg changes are documented here.

## [0.1.0] - 2026-09-27

### Added

- Local-first monthly A4 calendar generation.
- One vertical Spanish Monday-first template.
- Argentine national holiday support for `inamovible` and `trasladable` records.
- Local JSON holiday coverage with ArgentinaDatos fallback.
- Offline degraded generation with explicit unverified-holiday diagnostics.
- Protected writable regions optimized for handwriting.
- Restricted SVG and `rsvg-convert` PDF rendering.
- Local `npm run generate` command.
- Real local rsvg/Poppler integration tests.
- Printer-scoped calibration evidence for HP LaserJet 1020.

### Scope limitations

- The 10 mm safe area is experimental and validated only for the documented printer configuration.
- Moon phases, additional templates, editing, cloud services, and backend features are deferred.
- ArgentinaDatos is a non-official optional fallback; local coverage remains the primary source.
