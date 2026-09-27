import assert from "node:assert/strict";
import test from "node:test";

import {
  validateHolidayCoverage,
  type HolidayCoverageCandidate,
} from "../src/domain/holidays.ts";

const coverage = (
  overrides: Partial<HolidayCoverageCandidate> = {},
): HolidayCoverageCandidate => ({
  year: 2024,
  scope: "argentina-national",
  coveredFrom: "2024-01-01",
  coveredThrough: "2024-12-31",
  provenance: {
    source: "fixed-fixture",
    retrievedOn: "2024-01-01",
    validThrough: "2024-12-31",
  },
  holidays: [
    {
      date: "2024-03-24",
      label: "National Day of Remembrance",
      classification: "inamovible",
      scope: "argentina-national",
    },
    {
      date: "2024-06-17",
      label: "Martín Miguel de Güemes Day",
      classification: "trasladable",
      scope: "argentina-national",
    },
    {
      date: "2024-04-01",
      label: "Tourism bridge day",
      classification: "puente",
      scope: "argentina-national",
    },
  ],
  ...overrides,
});

test("normalizes complete Argentine national coverage and excludes valid puente records", () => {
  const result = validateHolidayCoverage(coverage(), "2024-06-01");

  assert.deepEqual(result, {
    ok: true,
    value: {
      year: 2024,
      scope: "argentina-national",
      status: "valid",
      coveredFrom: "2024-01-01",
      coveredThrough: "2024-12-31",
      provenance: {
        source: "fixed-fixture",
        retrievedOn: "2024-01-01",
        validThrough: "2024-12-31",
      },
      holidays: [
        {
          date: "2024-03-24",
          label: "National Day of Remembrance",
          classification: "inamovible",
        },
        {
          date: "2024-06-17",
          label: "Martín Miguel de Güemes Day",
          classification: "trasladable",
        },
      ],
    },
    diagnostics: [],
  });
});

test("treats an absent date in complete valid coverage as no holiday", () => {
  const result = validateHolidayCoverage(coverage({ holidays: [] }), "2024-06-01");

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.holidays.find((holiday) => holiday.date === "2024-07-09"), undefined);
  }
});

test("rejects invalid holiday records and missing provenance", () => {
  const invalidCandidates: readonly HolidayCoverageCandidate[] = [
    coverage({
      holidays: [
        {
          date: "2024-02-30",
          label: "Impossible date",
          classification: "inamovible",
          scope: "argentina-national",
        },
      ],
    }),
    coverage({
      holidays: [
        {
          date: "2025-01-01",
          label: "Wrong year",
          classification: "inamovible",
          scope: "argentina-national",
        },
      ],
    }),
    coverage({
      holidays: [
        {
          date: "2024-05-01",
          label: "Unknown classification",
          classification: "provincial",
          scope: "argentina-national",
        },
      ],
    }),
    coverage({
      holidays: [
        {
          date: "2024-05-01",
          label: "Provincial only",
          classification: "inamovible",
          scope: "argentina-provincial" as "argentina-national",
        },
      ],
    }),
    coverage({
      holidays: [
        {
          date: "2024-05-01",
          label: "   ",
          classification: "inamovible",
          scope: "argentina-national",
        },
      ],
    }),
    coverage({
      holidays: [
        {
          date: "2024-05-01",
          label: "Workers' Day",
          classification: "inamovible",
          scope: "argentina-national",
        },
        {
          date: "2024-05-01",
          label: "Different label",
          classification: "inamovible",
          scope: "argentina-national",
        },
      ],
    }),
    coverage({ provenance: undefined as never }),
  ];

  for (const candidate of invalidCandidates) {
    const result = validateHolidayCoverage(candidate, "2024-06-01");
    assert.equal(result.ok, false);
    assert.equal(result.status, "invalid");
  }
});

test("reports incomplete and expired coverage without accepting it", () => {
  const incomplete = validateHolidayCoverage(
    coverage({ coveredThrough: "2024-06-30" }),
    "2024-06-01",
  );
  const expired = validateHolidayCoverage(coverage(), "2025-01-01");

  assert.deepEqual(incomplete.ok, false);
  assert.equal(incomplete.status, "incomplete");
  assert.deepEqual(expired.ok, false);
  assert.equal(expired.status, "expired");
});
