import assert from "node:assert/strict";
import test from "node:test";

import {
  ArgentinaDatosHolidayGateway,
  HolidayResolver,
  type HolidayCoverageStore,
} from "../src/holiday-resolver.ts";
import {
  ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
  type Clock,
  type Diagnostic,
  type Transport,
} from "../src/contracts.ts";
import type { HolidayCoverage } from "../src/holidays.ts";

const clock: Clock = {
  now: () => new Date("2025-02-03T12:00:00.000Z"),
};

const validCoverage = (year = 2025): HolidayCoverage => ({
  year,
  scope: ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
  status: "valid",
  coveredFrom: `${year}-01-01`,
  coveredThrough: `${year}-12-31`,
  provenance: {
    source: "local-fixture",
    retrievedOn: "2025-01-01",
    validThrough: `${year}-12-31`,
  },
  holidays: [{
    date: `${year}-01-01`,
    label: "New Year",
    classification: "inamovible",
  }],
});

class MemoryStore implements HolidayCoverageStore {
  readonly values = new Map<number, unknown>();
  readonly commits: HolidayCoverage[] = [];

  async load(year: number): Promise<unknown | undefined> {
    return this.values.get(year);
  }

  async commit(coverage: HolidayCoverage): Promise<void> {
    this.commits.push(coverage);
    this.values.set(coverage.year, coverage);
  }
}

const response = [
  { fecha: "2025-01-01", tipo: "inamovible", nombre: "New Year" },
  { fecha: "2025-03-24", tipo: "trasladable", nombre: "Memorial Day" },
  { fecha: "2025-05-02", tipo: "puente", nombre: "Bridge holiday" },
];

const diagnosticCodes = (diagnostics: readonly Diagnostic[]): readonly string[] =>
  diagnostics.map(({ code }) => code);

test("loads valid local coverage without a transport call", async () => {
  const store = new MemoryStore();
  store.values.set(2025, validCoverage());
  let calls = 0;
  const transport: Transport<string, unknown> = {
    send: async () => {
      calls += 1;
      return response;
    },
  };
  const resolver = new HolidayResolver(
    store,
    new ArgentinaDatosHolidayGateway(transport),
    clock,
  );

  const result = await resolver.resolve(2025, ARGENTINE_NATIONAL_HOLIDAY_SCOPE);

  assert.equal(result.verification, "verified");
  assert.deepEqual(result.coverage, validCoverage());
  assert.equal(calls, 0);
  assert.deepEqual(result.diagnostics, []);
});

test("fetches, normalizes, persists, and verifies ArgentinaDatos coverage", async () => {
  const store = new MemoryStore();
  const requests: string[] = [];
  const transport: Transport<string, unknown> = {
    send: async (request) => {
      requests.push(request);
      return response;
    },
  };
  const resolver = new HolidayResolver(
    store,
    new ArgentinaDatosHolidayGateway(transport),
    clock,
  );

  const result = await resolver.resolve(2025, ARGENTINE_NATIONAL_HOLIDAY_SCOPE);

  assert.equal(result.verification, "verified");
  assert.deepEqual(requests, ["https://api.argentinadatos.com/v1/feriados/2025"]);
  assert.equal(store.commits.length, 1);
  assert.deepEqual(result.coverage?.holidays, [
    { date: "2025-01-01", label: "New Year", classification: "inamovible" },
    { date: "2025-03-24", label: "Memorial Day", classification: "trasladable" },
  ]);
  assert.deepEqual(result.coverage?.provenance, {
    source: "ArgentinaDatos",
    retrievedOn: "2025-02-03",
    validThrough: "2025-12-31",
  });
});

test("accepts complete historical ArgentinaDatos coverage after its valid-through date", async () => {
  const store = new MemoryStore();
  const requests: string[] = [];
  const transport: Transport<string, unknown> = {
    send: async (request) => {
      requests.push(request);
      return [
        { fecha: "2024-05-01", tipo: "inamovible", nombre: "Workers' Day" },
        { fecha: "2024-05-02", tipo: "puente", nombre: "Bridge holiday" },
      ];
    },
  };
  const resolver = new HolidayResolver(
    store,
    new ArgentinaDatosHolidayGateway(transport),
    clock,
  );

  const result = await resolver.resolve(2024, ARGENTINE_NATIONAL_HOLIDAY_SCOPE);

  assert.equal(result.verification, "verified");
  assert.deepEqual(requests, ["https://api.argentinadatos.com/v1/feriados/2024"]);
  assert.equal(store.commits.length, 1);
  assert.deepEqual(store.commits[0]?.holidays, [
    { date: "2024-05-01", label: "Workers' Day", classification: "inamovible" },
  ]);
  assert.deepEqual(result.coverage?.holidays, store.commits[0]?.holidays);
  assert.deepEqual(result.coverage?.provenance, {
    source: "ArgentinaDatos",
    retrievedOn: "2025-02-03",
    validThrough: "2024-12-31",
  });
});

test("returns unverified diagnostics and preserves local data when fallback cannot be used", async (t) => {
  await t.test("missing remote year", async () => {
    const store = new MemoryStore();
    const resolver = new HolidayResolver(
      store,
      new ArgentinaDatosHolidayGateway({ send: async () => [] }),
      clock,
    );

    const result = await resolver.resolve(2025, ARGENTINE_NATIONAL_HOLIDAY_SCOPE);

    assert.equal(result.verification, "unverified");
    assert.ok(diagnosticCodes(result.diagnostics).includes("MISSING_REMOTE_HOLIDAY_YEAR"));
    assert.equal(store.commits.length, 0);
  });

  await t.test("transport failure", async () => {
    const store = new MemoryStore();
    const prior = { retained: true };
    store.values.set(2025, prior);
    const resolver = new HolidayResolver(
      store,
      new ArgentinaDatosHolidayGateway({ send: async () => { throw new Error("timeout"); } }),
      clock,
    );

    const result = await resolver.resolve(2025, ARGENTINE_NATIONAL_HOLIDAY_SCOPE);

    assert.equal(result.verification, "unverified");
    assert.equal(result.coverage, undefined);
    assert.ok(diagnosticCodes(result.diagnostics).includes("LOCAL_COVERAGE_INVALID"));
    assert.ok(diagnosticCodes(result.diagnostics).includes("HOLIDAY_TRANSPORT_FAILED"));
    assert.equal(store.values.get(2025), prior);
  });

  await t.test("invalid response", async () => {
    const store = new MemoryStore();
    const resolver = new HolidayResolver(
      store,
      new ArgentinaDatosHolidayGateway({ send: async () => [{ fecha: "bad", tipo: "inamovible", nombre: "Bad" }] }),
      clock,
    );

    const result = await resolver.resolve(2025, ARGENTINE_NATIONAL_HOLIDAY_SCOPE);

    assert.equal(result.verification, "unverified");
    assert.ok(diagnosticCodes(result.diagnostics).includes("INVALID_REMOTE_HOLIDAY_COVERAGE"));
    assert.equal(store.commits.length, 0);
  });

  await t.test("unsupported future year", async () => {
    const store = new MemoryStore();
    let calls = 0;
    const resolver = new HolidayResolver(
      store,
      new ArgentinaDatosHolidayGateway({ send: async () => { calls += 1; return response; } }),
      clock,
    );

    const result = await resolver.resolve(2026, ARGENTINE_NATIONAL_HOLIDAY_SCOPE);

    assert.equal(result.verification, "unverified");
    assert.ok(diagnosticCodes(result.diagnostics).includes("UNSUPPORTED_FUTURE_HOLIDAY_YEAR"));
    assert.equal(calls, 0);
  });

  await t.test("persistence failure", async () => {
    const store: HolidayCoverageStore = {
      load: async () => undefined,
      commit: async () => { throw new Error("disk unavailable"); },
    };
    const resolver = new HolidayResolver(
      store,
      new ArgentinaDatosHolidayGateway({ send: async () => response }),
      clock,
    );

    const result = await resolver.resolve(2025, ARGENTINE_NATIONAL_HOLIDAY_SCOPE);

    assert.equal(result.verification, "unverified");
    assert.equal(result.coverage, undefined);
    assert.ok(diagnosticCodes(result.diagnostics).includes("HOLIDAY_PERSISTENCE_FAILED"));
  });
});
