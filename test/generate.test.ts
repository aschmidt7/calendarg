import assert from "node:assert/strict";
import test from "node:test";

import {
  generateMonthlyCalendarPdf,
  type GenerationServiceDependencies,
} from "../src/application/generate.ts";
import {
  ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
  V1_TEMPLATE,
  type Diagnostic,
} from "../src/contracts.ts";
import {
  ArgentinaDatosHolidayGateway,
  HolidayResolver,
  type HolidayCoverageStore,
  type HolidayResolution,
} from "../src/application/holiday-resolver.ts";
import type { HolidayCoverage } from "../src/domain/holidays.ts";
import type { PdfRenderDependencies } from "../src/infrastructure/pdf.ts";

const request = {
  year: 2025,
  month: 5,
  template: V1_TEMPLATE,
  holidayScope: ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
};

const coverage = (): HolidayCoverage => ({
  year: 2025,
  scope: ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
  status: "valid",
  coveredFrom: "2025-01-01",
  coveredThrough: "2025-12-31",
  provenance: {
    source: "test-fixture",
    retrievedOn: "2025-01-01",
    validThrough: "2025-12-31",
  },
  holidays: [{
    date: "2025-05-01",
    label: "Workers Day",
    classification: "inamovible",
  }],
});

const pdfDependencies = (events: string[] = []): PdfRenderDependencies => {
  const files = new Map<string, Uint8Array>();
  let nextPath = 0;
  let serializedSvg = "";
  const textFromSvg = (): string => [...serializedSvg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
    .map((match) => match[1])
    .join("\n");

  return {
    fileSystem: {
      allocateTemporaryPath: async (suffix) => `/controlled/${++nextPath}${suffix}`,
      writeFile: async (path, value) => {
        if (typeof value === "string") serializedSvg = value;
        files.set(path, typeof value === "string" ? new TextEncoder().encode(value) : value);
      },
      readFile: async (path) => files.get(path) ?? (() => { throw new Error("missing test file"); })(),
      exists: async (path) => files.has(path),
      remove: async (path) => { files.delete(path); },
    },
    process: {
      run: async (_executable, args) => {
        events.push("render");
        files.set(args[2], Uint8Array.of(37, 80, 68, 70));
        return { exitCode: 0 };
      },
    },
    inspector: {
      pdfinfo: async () => "Pages:           1\nPage size:       595.28 x 841.89 pts (A4)\n",
      pdffonts: async () => "DejaVuSans TrueType yes\n",
      pdftotext: async () => textFromSvg(),
    },
  };
};

const verifiedResolution = (): HolidayResolution => ({
  verification: "verified",
  coverage: coverage(),
  diagnostics: [],
});

const serviceDependencies = (
  resolver: GenerationServiceDependencies["holidayResolver"],
  events: string[] = [],
): GenerationServiceDependencies => ({
  holidayResolver: resolver,
  pdf: pdfDependencies(events),
});

test("rejects an invalid v1 request without resolving holidays or rendering", async () => {
  const events: string[] = [];
  let resolves = 0;
  const result = await generateMonthlyCalendarPdf(
    { ...request, template: "unsupported" },
    serviceDependencies({
      resolve: async () => {
        resolves += 1;
        return verifiedResolution();
      },
    }, events),
  );

  assert.equal(result.ok, false);
  assert.equal(resolves, 0);
  assert.deepEqual(events, []);
  assert.ok(result.diagnostics.some(({ code }) => code === "UNSUPPORTED_TEMPLATE"));
});

test("renders verified local-only coverage without transport and exposes canonical trace metadata", async () => {
  class Store implements HolidayCoverageStore {
    async load(): Promise<unknown> {
      return coverage();
    }
    async commit(): Promise<void> {
      throw new Error("local coverage must not be persisted");
    }
  }

  let transportCalls = 0;
  const resolver = new HolidayResolver(
    new Store(),
    new ArgentinaDatosHolidayGateway({
      send: async () => {
        transportCalls += 1;
        return [];
      },
    }),
    { now: () => new Date("2025-02-03T12:00:00.000Z") },
  );

  const result = await generateMonthlyCalendarPdf(request, serviceDependencies(resolver));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(transportCalls, 0);
  assert.equal(result.holidayVerification, "verified");
  assert.equal(result.calendar.holidayVerification, "verified");
  assert.equal(result.artifact.mediaType, "application/pdf");
  assert.equal(result.trace.templateId, "monthly-calendar-a4-vertical-v1");
  assert.match(result.trace.irSha256, /^[a-f0-9]{64}$/);
  assert.match(result.trace.svgSha256, /^[a-f0-9]{64}$/);
  assert.ok(result.svg.includes("Workers Day"));
  assert.ok(!result.svg.includes("sha256") && !result.svg.includes("diagnostics"));
});

test("persists refreshed coverage before the PDF renderer is called", async () => {
  const events: string[] = [];
  class Store implements HolidayCoverageStore {
    async load(): Promise<undefined> {
      return undefined;
    }
    async commit(): Promise<void> {
      events.push("persist");
    }
  }

  const resolver = new HolidayResolver(
    new Store(),
    new ArgentinaDatosHolidayGateway({
      send: async () => [{ fecha: "2025-05-01", tipo: "inamovible", nombre: "Workers Day" }],
    }),
    { now: () => new Date("2025-02-03T12:00:00.000Z") },
  );

  const result = await generateMonthlyCalendarPdf(request, serviceDependencies(resolver, events));

  assert.equal(result.ok, true);
  assert.deepEqual(events, ["persist", "render"]);
});

test("degrades offline holiday coverage to a disclosed day-number-only PDF", async () => {
  const diagnostics: readonly Diagnostic[] = [{
    code: "HOLIDAY_TRANSPORT_FAILED",
    severity: "warning",
    message: "Holiday fallback could not be retrieved.",
    path: [],
  }];
  const result = await generateMonthlyCalendarPdf(request, serviceDependencies({
    resolve: async () => ({ verification: "unverified", diagnostics }),
  }));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.holidayVerification, "unverified");
  assert.equal(result.calendar.holidayVerification, "unverified");
  assert.ok(result.diagnostics.some(({ code }) => code === "HOLIDAY_TRANSPORT_FAILED"));
  assert.ok(result.document.elements.every((element) => element.role !== "holiday-label"));
  assert.ok(!result.svg.includes("Workers Day"));
  assert.ok(result.svg.includes(">1</text>"));
});
