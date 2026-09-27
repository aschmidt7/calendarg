# Calendarg v0.1.0 Code Review

**Review type:** Read-only general code-quality and development-practices review
**Review scope:** Root product tree at the `feat/monthly-calendar-v1` branch, including `src/`, `test/`, `data/`, `evidence/`, `package.json`, `README.md`, and `CHANGELOG.md`
**Review date:** 2026-09-27
**Product version:** 0.1.0
**Review limitation:** This document records static review findings and recommendations. The product test suite had previously passed 67 tests, including the real local rsvg/Poppler integration; no new tests were executed as part of the read-only review.

## Executive summary

Calendarg v0.1.0 has a solid functional core and a clear printable-calendar pipeline:

```text
request
  -> holiday resolution
  -> deterministic monthly model
  -> physical layout
  -> canonical IR
  -> restricted SVG
  -> inspected PDF
```

The implementation already applies several good practices: deterministic date arithmetic, injected process/filesystem seams, atomic local persistence, restricted SVG output, explicit degraded-mode behavior, bounded writable regions, and real renderer integration tests.

The review identified three highest-priority risks before calling the product production-ready:

1. a partial remote holiday response can be accepted as complete verified coverage;
2. holiday fitting still relies on an approximation rather than renderer-accurate glyph bounds;
3. PDF embedded-font validation is too permissive and can produce false positives.

The remaining findings are mostly operational and maintainability improvements: explicit native-tool preflight, CLI overwrite policy, persisted-status validation, year-9999 handling, dependency-direction cleanup, evidence reproducibility, and CLI ergonomics.

This review does not block the experimental `0.1.0` product baseline, but it should guide the GitHub issue backlog and the next implementation slices.

## Findings

### P1 — Partial holiday payloads can become verified full-year coverage

**Locations**

- `src/application/holiday-resolver.ts` — remote candidate construction and acceptance.
- `src/domain/holidays.ts` — coverage validation.
- `test/holiday-resolver.test.ts` — remote-response acceptance coverage.

**Evidence**

The resolver constructs `coveredFrom` and `coveredThrough` as the complete requested year regardless of how many records the remote response contains. The coverage validator verifies the declared date range and provenance, but has no independent completeness criterion. A response containing one valid renderable holiday can therefore be persisted as a complete year.

**Impact**

A partial, filtered, or temporarily incomplete ArgentinaDatos response can be reported as `verified`, causing omitted holidays to disappear silently from a generated calendar.

**Classification**

Confirmed logic defect. The occurrence depends on an incomplete upstream response, but the acceptance path is currently real.

**Recommended remediation**

Define a credible completeness policy before accepting `verified` coverage. Candidate approaches:

- validate against an expected national-holiday set for the requested year;
- require provider completeness metadata;
- validate against a documented official annual source;
- retain `unverified` status whenever completeness cannot be demonstrated.

Add tests for an incomplete response that contains one or more valid holidays and assert that it is not persisted or reported as verified.

---

### P2 — Holiday fitting is based on approximate metrics

**Locations**

- `src/rendering/holiday-fitting.ts` — deterministic fallback metrics.
- `src/rendering/layout-ir.ts` — fitted line/box construction.
- `src/infrastructure/pdf.ts` — PDF inspection.
- `test/real-renderer.test.ts` — real output checks.

**Evidence**

The fitting algorithm uses a conservative deterministic approximation rather than actual DejaVu Sans glyph metrics. The PDF integration verifies page, font, and extracted text facts, but does not measure actual rendered text bounds against the annotation box or protected writing region.

**Impact**

A label can pass IR-level fitting and still clip, overlap, or intrude into the protected handwriting region in the actual renderer. Spanish accents, glyph widths, kerning, and line behavior can differ from the approximation.

**Recommended remediation**

Add renderer-level bounds evidence:

- extract text coordinates with Poppler `pdftotext -bbox`;
- associate each rendered label with its expected cell/annotation box;
- verify every label box remains within the annotation area;
- verify no label intersects a protected writing region;
- keep the approximation only as a pre-render guard.

Add regression fixtures for long labels such as `Día de la Revolución de Mayo` and additional accented Spanish names.

---

### P2 — Embedded DejaVu Sans detection can produce false positives

**Locations**

- `src/infrastructure/pdf.ts` — `pdffonts` parsing.
- `test/pdf.test.ts` — PDF font fixtures.

**Evidence**

The current validator searches for a DejaVu Sans-like line containing any standalone `yes`. `pdffonts` exposes separate `emb`, `sub`, and `uni` columns, so a line with `emb=no` and another `yes` value can satisfy the broad expression.

**Impact**

A PDF without an embedded font may be accepted as if it satisfied the embedding requirement.

**Recommended remediation**

Parse the `pdffonts` columns explicitly and require:

```text
font family = DejaVu Sans
emb = yes
```

Add adversarial fixtures such as:

```text
DejaVuSans TrueType no yes yes
```

and ensure they are rejected.

---

### P2 — Native runtime prerequisites are hard-coded and not preflighted

**Locations**

- `src/cli/cli.ts` — `/usr/bin/curl`.
- `src/infrastructure/pdf.ts` — `/usr/bin/rsvg-convert`.
- `src/infrastructure/runtime.ts` — Poppler executable paths.
- `test/real-renderer.test.ts` — integration skip behavior.
- `package.json`, `README.md` — missing environment contract.

**Evidence**

The product depends on Linux absolute paths and Node's experimental TypeScript stripping. The integration test skips if tools are missing, so a passing suite can omit real renderer evidence on another machine.

**Impact**

A clean environment can appear healthy while lacking required production tools. Failures occur late and are not self-diagnosing.

**Recommended remediation**

Add a capability command, for example:

```bash
npm run doctor
```

It should report:

- supported Node version;
- `rsvg-convert` version;
- `pdfinfo`, `pdffonts`, and `pdftotext` versions;
- curl availability;
- DejaVu Sans availability/embedding prerequisites;
- writable data/output directories.

Document whether Linux is the only supported platform. If portability is desired, allow safe configured/PATH-based executable resolution with explicit defaults.

---

### P2 — CLI overwrites output files without an explicit policy

**Locations**

- `src/cli/cli.ts` — output write path.
- `README.md` — command documentation.
- `test/cli.test.ts` — missing overwrite behavior coverage.

**Evidence**

The CLI creates parent directories and writes directly to the requested path. There is no `--force`, `--no-clobber`, confirmation, or documented overwrite behavior.

**Impact**

A mistyped output path or repeated default generation can silently replace an existing PDF.

**Recommended remediation**

Choose and document one policy. Preferred:

- fail if the target exists by default;
- require `--force` to replace it;
- use a temporary file plus atomic rename for successful writes.

Add tests for both default refusal and explicit overwrite.

---

### P3 — Persisted coverage status is not validated consistently on read

**Locations**

- `src/domain/holidays.ts` — coverage validation.
- `src/infrastructure/holiday-repository.ts` — load/commit behavior.

**Evidence**

The validator does not use the persisted `status` field as an input condition and returns a normalized `valid` object after structural checks. A manually edited file marked `expired` or `invalid` can therefore be normalized into valid coverage if the remaining data passes validation.

**Impact**

The persisted status field is misleading and does not protect the local-data boundary from an externally marked invalid cache.

**Recommended remediation**

Either validate the persisted status explicitly or remove it from persisted input and derive status only from coverage dates, provenance, integrity, and policy.

---

### P3 — Year 9999 can produce invalid adjacent ISO dates

**Locations**

- `src/application/request.ts`.
- `src/domain/month.ts`.
- `src/application/cli.ts`.
- `test/month.test.ts`.

**Evidence**

The public input accepts year 9999. December 9999 may then create an adjacent date in year 10000, while the rest of the system uses four-digit `YYYY-MM-DD` values.

**Impact**

The visual result may look plausible while the internal date contract becomes invalid at a public input boundary.

**Recommended remediation**

Limit v1 to years 1–9998, or explicitly support five-digit years throughout the date contract. The simpler v1 policy is to reject year 9999 when adjacent-month cells are required.

---

### P3 — PDF determinism is not fully demonstrated

**Locations**

- `src/application/generate.ts` — IR/SVG hashes.
- `src/infrastructure/pdf.ts` — external renderer invocation.
- `test/real-renderer.test.ts` — single successful render.
- `evidence/release-v1.md` — artifact evidence.

**Evidence**

IR and SVG serialization are deterministic, but the final PDF depends on the external renderer, fonts, metadata, and platform. The current trace hashes IR/SVG, not a normalized reproducibility result for the PDF.

**Impact**

The reported PDF SHA-256 identifies one artifact but does not establish repeatable byte identity across executions or environments.

**Recommended remediation**

For release evidence:

- render twice with identical inputs;
- compare raw hashes when the environment is pinned;
- otherwise normalize metadata and compare semantic facts;
- record renderer/font/tool versions and all input hashes.

---

### P3 — Domain/application dependency direction should be improved

**Locations**

- `src/domain/month.ts` imports `HolidayResolution` from `src/application/holiday-resolver.ts`.
- `src/application/generate.ts` imports the concrete PDF implementation.
- `src/application/holiday-resolver.ts` contains the ArgentinaDatos URL and mapping.
- `src/contracts.ts` contains generic ports that are only partially used.

**Impact**

The domain depends upward on application types and application orchestration depends downward on concrete infrastructure. The architecture works, but future templates, API changes, and renderer changes will create unnecessary coupling.

**Recommended remediation**

- Move `HolidayResolution` to shared/domain contracts.
- Move the ArgentinaDatos adapter to infrastructure.
- Define a focused application-level PDF renderer port.
- Wire concrete adapters only in the CLI/composition root.
- Either adopt the existing generic ports consistently or remove/rework them to avoid duplicate architecture models.

---

### P3 — CLI ergonomics and environment diagnosis can improve

**Locations**

- `src/cli/cli.ts`.
- `package.json`.
- `README.md`.

**Opportunities**

- Add `--help`.
- Add `--version`.
- Document the JSON output schema and stable error codes.
- Add `engines` metadata for supported Node versions.
- Add `doctor`, `typecheck`, `verify`, and `release:check` scripts.
- Make calibration generation an explicit package script.

## Positive practices

- Explicit pipeline from request to inspected PDF.
- Host-independent Gregorian date arithmetic.
- Local-first holiday resolution and explicit offline degradation.
- Atomic JSON coverage persistence.
- Shell-free child-process invocation.
- Controlled temporary paths and cleanup.
- Restricted SVG grammar with escaped text.
- Explicit safe-area and writable-region invariants.
- Real local rsvg/Poppler integration coverage.
- Strong dependency-injection seams for tests.
- Printer and data-source claims are scoped rather than universal.
- Conventional commits and SemVer metadata are established.

## Recommended issue backlog

Once the repository is published, create GitHub issues for at least:

1. Reject incomplete remote holiday coverage as verified.
2. Validate rendered holiday text bounds with Poppler evidence.
3. Parse `pdffonts` embedding columns strictly.
4. Add runtime/toolchain doctor command.
5. Add CLI output overwrite policy.
6. Validate or remove persisted coverage status.
7. Resolve year-9999 adjacent-date behavior.
8. Define PDF reproducibility evidence.
9. Restore domain/application dependency direction.
10. Add CLI help/version and release-check tooling.

## Review conclusion

Calendarg v0.1.0 is a credible experimental product baseline with good deterministic and testability practices. The first remediation priority is the holiday coverage completeness contract, followed by rendered text-bound verification and strict PDF font validation. These findings should become the first GitHub issue backlog after the initial product push.
