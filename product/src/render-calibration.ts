import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
  V1_TEMPLATE,
} from "./contracts.ts";
import { generateMonthlyCalendarPdf } from "./generate.ts";
import type { HolidayResolution } from "./holiday-resolver.ts";
import {
  NodePdfFileSystem,
  NodePdfInspectionSeam,
  NodePdfProcess,
} from "./runtime.ts";

const HOLIDAY_LABEL = "Día del Trabajador";
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const productDirectory = resolve(moduleDirectory, "..");
const defaultOutputPath = join(
  productDirectory,
  "evidence",
  "output",
  "monthly-calendar-2024-05.pdf",
);

const fixtureResolution: HolidayResolution = {
  verification: "verified",
  coverage: {
    year: 2024,
    scope: ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
    status: "valid",
    coveredFrom: "2024-01-01",
    coveredThrough: "2024-12-31",
    provenance: {
      source: "render-calibration-fixture",
      retrievedOn: "2024-01-01",
      validThrough: "2024-12-31",
    },
    holidays: [{
      date: "2024-05-01",
      label: HOLIDAY_LABEL,
      classification: "inamovible",
    }],
  },
  diagnostics: [],
};

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const inspectionFact = (
  pdfinfo: string,
  pdffonts: string,
  text: string,
) => {
  const pages = pdfinfo.match(/^Pages:\s*(\d+)\s*$/m)?.[1];
  const pageSize = pdfinfo.match(/^Page size:\s*(.+)$/m)?.[1]?.trim();
  const embeddedDejaVuSans = pdffonts
    .split(/\r?\n/)
    .some((line) => /dejavu[\s-]*sans/i.test(line) && /\byes\b/i.test(line));

  return {
    pages: pages === undefined ? null : Number(pages),
    pageSize,
    a4Portrait: /595(?:\.\d+)?\s+x\s+841(?:\.\d+)?\s+pts\b/i.test(pdfinfo),
    embeddedDejaVuSans,
    extractedTextNonEmpty: text.trim().length > 0,
    extractedTextIncludesHoliday: text.includes(HOLIDAY_LABEL),
  };
};

const run = async (): Promise<void> => {
  const requestedOutput = process.argv[2];
  const outputPath = requestedOutput === undefined
    ? defaultOutputPath
    : resolve(process.cwd(), requestedOutput);
  const processAdapter = new NodePdfProcess();
  const inspector = new NodePdfInspectionSeam(processAdapter);
  const result = await generateMonthlyCalendarPdf(
    {
      year: 2024,
      month: 5,
      template: V1_TEMPLATE,
      holidayScope: ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
    },
    {
      holidayResolver: {
        resolve: async (year, scope) => {
          if (year !== 2024 || scope !== ARGENTINE_NATIONAL_HOLIDAY_SCOPE) {
            throw new Error("The calibration fixture only supports May 2024 national holidays.");
          }
          return fixtureResolution;
        },
      },
      pdf: {
        fileSystem: new NodePdfFileSystem({
          tempRoot: join(tmpdir(), "monthly-calendar-render-calibration"),
        }),
        process: processAdapter,
        inspector,
      },
    },
  );

  if (!result.ok) {
    throw new Error(`Calendar generation was rejected: ${JSON.stringify(result.diagnostics)}`);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.artifact.bytes);

  const [pdfinfo, pdffonts, text] = await Promise.all([
    inspector.pdfinfo(outputPath),
    inspector.pdffonts(outputPath),
    inspector.pdftotext(outputPath),
  ]);
  const holidayInCalendar = result.calendar.weeks.some((week) =>
    week.some((day) => day.holiday?.label === HOLIDAY_LABEL)
  );

  console.log(JSON.stringify({
    outputPath,
    bytes: result.artifact.bytes.byteLength,
    sha256: sha256(result.artifact.bytes),
    holiday: {
      verification: result.holidayVerification,
      label: HOLIDAY_LABEL,
      calendarLabelPresent: holidayInCalendar,
    },
    inspection: inspectionFact(pdfinfo, pdffonts, text),
  }));
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ error: message }));
  process.exitCode = 1;
});
