import assert from "node:assert/strict";
import test from "node:test";

import {
  renderRestrictedSvgToPdf,
  type PdfFileSystem,
  type PdfInspectionSeam,
  type PdfProcess,
  type PdfRenderDependencies,
  type ProcessResult,
} from "../src/pdf.ts";
import { buildLayoutDocument, type LayoutDocument } from "../src/layout-ir.ts";
import { deriveMonthlyCalendarLayout, PROPOSED_COMPACT_HEADER_A4_POLICY } from "../src/layout-policy.ts";
import { buildMonthlyCalendar } from "../src/month.ts";
import { serializeRestrictedSvg } from "../src/svg.ts";
import { deriveWritableRegions } from "../src/writable-regions.ts";
import type { HolidayResolution } from "../src/holiday-resolver.ts";
import type { HolidayCoverage } from "../src/holidays.ts";

const verifiedCoverage = (
  year: number,
  holidays: HolidayCoverage["holidays"],
): HolidayResolution => ({
  verification: "verified",
  coverage: {
    year,
    scope: "argentina-national",
    status: "valid",
    coveredFrom: `${year.toString().padStart(4, "0")}-01-01`,
    coveredThrough: `${year.toString().padStart(4, "0")}-12-31`,
    provenance: {
      source: "fixture",
      retrievedOn: `${year.toString().padStart(4, "0")}-01-01`,
      validThrough: `${year.toString().padStart(4, "0")}-12-31`,
    },
    holidays,
  },
  diagnostics: [],
});

const restrictedSvg = (): string => {
  const calendar = buildMonthlyCalendar(
    { year: 2024, month: 5 },
    verifiedCoverage(2024, [{
      date: "2024-05-01",
      label: "Día del Trabajador",
      classification: "inamovible",
    }]),
  );
  const layout = deriveMonthlyCalendarLayout(calendar, PROPOSED_COMPACT_HEADER_A4_POLICY);
  const document: LayoutDocument = buildLayoutDocument(calendar, layout, deriveWritableRegions(layout, calendar));
  return serializeRestrictedSvg(document);
};

const validPdfInfo = "Pages:           1\nPage size:       595.28 x 841.89 pts (A4)\n";
const validFonts = "name                                 type              emb sub uni object ID\n------------------------------------ ----------------- --- --- --- ---------\nABCDEF+DejaVuSans                    TrueType          yes yes yes     10  0\n";
const validText = "Mayo 2024\nmiércoles\nDía del Trabajador\n";

interface HarnessOptions {
  readonly processResult?: ProcessResult;
  readonly writeOutput?: boolean;
  readonly pdfinfo?: string;
  readonly pdffonts?: string;
  readonly pdftotext?: string;
  readonly outputAlreadyExists?: boolean;
}

const createHarness = (options: HarnessOptions = {}) => {
  const files = new Map<string, Uint8Array>();
  const writes: Array<{ path: string; value: string | Uint8Array }> = [];
  const removals: string[] = [];
  const processCalls: Array<{ executable: string; args: readonly string[]; timeoutMs: number }> = [];
  let pathNumber = 0;
  const fileSystem: PdfFileSystem = {
    allocateTemporaryPath: async (suffix) => `/controlled/pdf-${++pathNumber}${suffix}`,
    writeFile: async (path, value) => {
      writes.push({ path, value });
      files.set(path, typeof value === "string" ? new TextEncoder().encode(value) : value);
    },
    readFile: async (path) => files.get(path) ?? (() => { throw new Error(`Missing ${path}`); })(),
    exists: async (path) => files.has(path),
    remove: async (path) => {
      removals.push(path);
      files.delete(path);
    },
  };
  if (options.outputAlreadyExists) files.set("/controlled/pdf-2.pdf", Uint8Array.of(1));

  const process: PdfProcess = {
    run: async (executable, args, runOptions) => {
      processCalls.push({ executable, args, timeoutMs: runOptions.timeoutMs });
      const result = options.processResult ?? { exitCode: 0 };
      if (result.exitCode === 0 && !result.timedOut && options.writeOutput !== false) {
        files.set(args[2], Uint8Array.of(37, 80, 68, 70));
      }
      return result;
    },
  };
  const inspector: PdfInspectionSeam = {
    pdfinfo: async () => options.pdfinfo ?? validPdfInfo,
    pdffonts: async () => options.pdffonts ?? validFonts,
    pdftotext: async () => options.pdftotext ?? validText,
  };
  const dependencies: PdfRenderDependencies = { fileSystem, process, inspector };
  return { dependencies, writes, removals, processCalls };
};

const render = (dependencies: PdfRenderDependencies) =>
  renderRestrictedSvgToPdf(restrictedSvg(), ["Mayo", "miércoles", "Día del Trabajador"], dependencies);

test("renders restricted SVG through explicit rsvg arguments and returns an inspected PDF artifact", async () => {
  const harness = createHarness();

  const result = await render(harness.dependencies);

  assert.equal(result.artifact.mediaType, "application/pdf");
  assert.deepEqual(result.artifact.bytes, Uint8Array.of(37, 80, 68, 70));
  assert.equal(result.artifact.pageCount, 1);
  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(harness.processCalls, [{
    executable: "/usr/bin/rsvg-convert",
    args: ["--format=pdf", "--output", "/controlled/pdf-2.pdf", "/controlled/pdf-1.svg"],
    timeoutMs: 20_000,
  }]);
  assert.equal(harness.writes[0].path, "/controlled/pdf-1.svg");
  assert.deepEqual(harness.removals, ["/controlled/pdf-1.svg", "/controlled/pdf-2.pdf"]);
});

test("rejects renderer backend failures and timeouts", async () => {
  for (const processResult of [{ exitCode: 7, stderr: "renderer failed" }, { exitCode: null, timedOut: true }]) {
    await assert.rejects(render(createHarness({ processResult }).dependencies), /rsvg-convert (failed|timed out)/);
  }
});

test("rejects missing or pre-existing renderer output", async () => {
  await assert.rejects(render(createHarness({ writeOutput: false }).dependencies), /did not create a fresh PDF output/);
  await assert.rejects(render(createHarness({ outputAlreadyExists: true }).dependencies), /must be fresh/);
});

test("rejects PDFs that do not contain exactly one page", async () => {
  await assert.rejects(
    render(createHarness({ pdfinfo: "Pages:           2\nPage size:       595.28 x 841.89 pts (A4)\n" }).dependencies),
    /exactly one page/,
  );
});

test("rejects non-A4 portrait PDF media geometry", async () => {
  await assert.rejects(
    render(createHarness({ pdfinfo: "Pages:           1\nPage size:       841.89 x 595.28 pts (A4)\n" }).dependencies),
    /A4 portrait media box/,
  );
});

test("rejects PDFs without embedded DejaVu Sans", async () => {
  await assert.rejects(
    render(createHarness({ pdffonts: "name type emb\nHelvetica Type1 no\n" }).dependencies),
    /embedded DejaVu Sans/,
  );
});

test("rejects PDFs missing required Spanish and Latin text", async () => {
  await assert.rejects(
    render(createHarness({ pdftotext: "Mayo 2024\nmiércoles\n" }).dependencies),
    /required text token: Día del Trabajador/,
  );
});
