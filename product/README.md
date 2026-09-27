# Calendarg

Calendarg is a local-first printable monthly calendar generator.

## v1 scope

- One vertical monthly template.
- One A4 portrait PDF per requested month.
- Monday-first Spanish weekday grid.
- Argentine national holidays (`inamovible` and `trasladable`).
- Local JSON holiday coverage first, with ArgentinaDatos as a replaceable fallback.
- Adjacent-month dates shown in light gray.
- Offline generation with an explicit unverified-holiday status.
- Experimental 10 mm safe-area baseline validated on the documented HP LaserJet 1020 setup.

Moon phases, additional templates, editing, cloud services, and backend features are deferred.

## Generate a calendar

```sh
npm run generate -- \
  --year 2024 \
  --month 5 \
  --output ./evidence/output/may-2024.pdf
```

Arguments:

- `--year YYYY` — required Gregorian year.
- `--month 1..12` — required month.
- `--output PATH` — optional PDF output path.
- `--data-root PATH` — optional local holiday coverage root.

The command prints JSON containing the output path, holiday verification state,
diagnostics, SHA-256, and PDF facts. If local coverage is unavailable, it may
use the public ArgentinaDatos fallback; if that fails, generation succeeds with
an explicitly unverified holiday state and no unverified labels.

## Test

```sh
npm test
```

The product currently has 67 passing tests, including real local
`rsvg-convert`/Poppler integration.
