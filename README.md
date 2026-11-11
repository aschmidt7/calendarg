# Calendarg

**Version:** `0.1.0`

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
- `--force` — optional; overwrite an existing output path. Without it, the
  command refuses to replace an existing file and exits with status 1.
- `--help` / `-h` — print plain-text usage to stdout and exit 0. Takes
  precedence over `--version` and works even without `--year`/`--month`.
- `--version` / `-V` — print the installed package version to stdout and
  exit 0.

The command prints JSON containing the output path, holiday verification state,
diagnostics, SHA-256, and PDF facts. If local coverage is unavailable, it may
use the public ArgentinaDatos fallback; if that fails, generation succeeds with
an explicitly unverified holiday state and no unverified labels. Output is
written atomically: the PDF is written to a temporary file next to the target
path, then renamed into place, so a failed or interrupted run never leaves a
partially written output file.

## Command output contract

`generate`, `doctor`, and `release-check` print a single JSON document to
stdout with documented fields (see each command's section) and exit with one
of:

- `0` — success, or a satisfied diagnostic report.
- `1` — a runtime failure, or a diagnostic report where at least one check
  failed (`ok: false`).
- `2` — an argument error (`generate` only); the error is reported as JSON on
  stderr instead of stdout.

`--help` and `--version` are the only exception: they print plain text to
stdout (not JSON) and always exit `0`, per Unix convention.

## Check your environment

```sh
npm run doctor
```

Prints a JSON report of the Node.js runtime and native prerequisites
(`rsvg-convert`, Poppler's `pdfinfo`/`pdffonts`/`pdftotext`, `curl`, the DejaVu
Sans font, and a writable local data root) and exits non-zero if any check
fails. This is the documented first step when generation fails in a new
environment.

## Check release metadata

```sh
npm run release-check
```

Prints a JSON report that verifies the project is internally consistent and
ready for release: that `package.json` parses and declares a non-empty semver
`version` and an `engines.node` constraint, that `README.md` mentions the
current version, that `CHANGELOG.md` documents a section for the current
version, and folds in every `npm run doctor` check. It never runs the test
suite itself; use `npm test` separately. Exits `0` only when every check is
ok, otherwise `1`.

## Supported platform and runtime

Calendarg is currently developed and verified on Linux only; its native
prerequisites are invoked at fixed `/usr/bin/*` paths (see `npm run doctor`).
macOS and Windows are not documented or tested targets for v1.

The declared minimum runtime is **Node.js 22.6.0**, the first version that
supports the `--experimental-strip-types` flag this project's `test`,
`generate`, and `doctor` scripts rely on to run TypeScript sources directly
without a build step. This remains the supported production runtime for v1:
there is no compiled-JavaScript build step, and none is planned while the
project stays this size. `engines.node` in `package.json` encodes this
minimum and is checked by `npm run doctor`/`npm run release-check`.

## Static type checking

```sh
npm run typecheck
```

Runs `tsc --noEmit` against `tsconfig.json` (strict mode) over `src/` and
`test/`. This is a dev-time and CI verification step only — it never emits
JavaScript and never runs as part of `npm run generate`, `npm run doctor`, or
`npm run release-check`, which stay dependency-free at runtime. It requires
the `typescript` and `@types/node` devDependencies (`npm install`); these are
not needed to run the product itself, only to typecheck it.

`npm run verify` runs `typecheck`, the test suite, and `release-check` in
sequence and is the recommended single command for CI and before a release.

## Test

```sh
npm test
```

The product currently has 101 passing tests, including real local
`rsvg-convert`/Poppler integration.

## Evidence limitations

Release evidence is documented under `evidence/`, while generated PDFs and
screenshots remain local-only artifacts outside the repository. The documented
physical print result applies only to the HP LaserJet 1020, driver, A4 media,
and disabled scaling configuration recorded in `evidence/printer-calibration.md`;
it is not a universal printer compatibility claim. Holiday coverage depends on
the maintained local JSON files, while ArgentinaDatos is an optional fallback
whose availability and authority are not guaranteed. See
`evidence/release-v1.md` for the complete release-boundary caveats.
