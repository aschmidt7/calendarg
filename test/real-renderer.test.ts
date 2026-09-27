import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ARGENTINE_NATIONAL_HOLIDAY_SCOPE, V1_TEMPLATE } from "../src/contracts.ts";
import { generateMonthlyCalendarPdf } from "../src/application/generate.ts";
import type { HolidayResolution } from "../src/application/holiday-resolver.ts";
import {
  NodePdfFileSystem,
  NodePdfInspectionSeam,
  NodePdfProcess,
} from "../src/infrastructure/runtime.ts";

const requiredExecutables = [
  "/usr/bin/rsvg-convert",
  "/usr/bin/pdfinfo",
  "/usr/bin/pdffonts",
  "/usr/bin/pdftotext",
] as const;

const localHolidayResolution: HolidayResolution = {
  verification: "verified",
  coverage: {
    year: 2024,
    scope: ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
    status: "valid",
    coveredFrom: "2024-01-01",
    coveredThrough: "2024-12-31",
    provenance: {
      source: "local integration fixture",
      retrievedOn: "2024-01-01",
      validThrough: "2024-12-31",
    },
    holidays: [{
      date: "2024-05-01",
      label: "Día del Trabajador",
      classification: "inamovible",
    }],
  },
  diagnostics: [],
};

const unavailableExecutable = async (): Promise<string | undefined> => {
  for (const executable of requiredExecutables) {
    try {
      await access(executable, constants.X_OK);
    } catch {
      return executable;
    }
  }
  return undefined;
};

test("renders the monthly calendar with the local rsvg and Poppler toolchain", async (t) => {
  const unavailable = await unavailableExecutable();
  if (unavailable) {
    t.skip(`required local executable is unavailable: ${unavailable}`);
    return;
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "monthly-calendar-real-renderer-"));
  const fileSystem = new NodePdfFileSystem({ tempRoot: temporaryRoot });
  const process = new NodePdfProcess();
  const inspector = new NodePdfInspectionSeam(process);

  try {
    const result = await generateMonthlyCalendarPdf({
      year: 2024,
      month: 5,
      template: V1_TEMPLATE,
      holidayScope: ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
    }, {
      holidayResolver: { resolve: async () => localHolidayResolution },
      pdf: { fileSystem, process, inspector },
      pdfOptions: { executable: "/usr/bin/rsvg-convert" },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.artifact.mediaType, "application/pdf");
    assert.ok(result.artifact.bytes.byteLength > 0, "the rendered PDF must be non-empty");
    assert.equal(result.artifact.pageCount, 1);
    assert.match(result.svg, /Mié/);
    assert.match(result.svg, /Sáb/);
    assert.match(result.svg, /Día del Trabajador/);
    assert.doesNotMatch(result.svg, /<metadata\b/i);
    assert.doesNotMatch(result.svg, /holiday[-_ ]?audit|audit[-_ ]?holiday/i);

    const inspectionPath = await fileSystem.allocateTemporaryPath(".pdf");
    try {
      await fileSystem.writeFile(inspectionPath, result.artifact.bytes);
      const [pdfinfo, pdffonts, text] = await Promise.all([
        inspector.pdfinfo(inspectionPath),
        inspector.pdffonts(inspectionPath),
        inspector.pdftotext(inspectionPath),
      ]);

      assert.match(pdfinfo, /^Pages:\s*1\s*$/m);
      assert.match(pdfinfo, /^Page size:\s*595(?:\.\d+)?\s+x\s+841(?:\.\d+)?\s+pts\b/m);
      assert.match(pdffonts, /dejavu[\s-]*sans.*\byes\b/i);
      for (const token of ["Mié", "Sáb", "Día del Trabajador"]) {
        assert.ok(text.includes(token), `the PDF text must contain ${token}`);
      }
    } finally {
      await fileSystem.remove(inspectionPath);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
