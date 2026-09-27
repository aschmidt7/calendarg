import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMonthlyCalendar,
  type MonthlyCalendar,
} from "../src/month.ts";
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

const cells = (calendar: MonthlyCalendar) => calendar.weeks.flat();

test("builds a deterministic Monday-first six-week Gregorian grid", () => {
  const calendar = buildMonthlyCalendar({ year: 2020, month: 3 });

  assert.equal(calendar.requestedYear, 2020);
  assert.equal(calendar.requestedMonth, 3);
  assert.equal(calendar.heading, "Marzo 2020");
  assert.deepEqual(calendar.weekdayHeaders, ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]);
  assert.equal(calendar.weeks.length, 6);
  assert.deepEqual(calendar.weeks[0][0], {
    isoDate: "2020-02-24",
    membership: "adjacent",
    dayNumber: 24,
    weekdayIndex: 0,
  });
  assert.deepEqual(calendar.weeks[5][6], {
    isoDate: "2020-04-05",
    membership: "adjacent",
    dayNumber: 5,
    weekdayIndex: 6,
  });
  assert.equal(cells(calendar).filter((cell) => cell.membership === "current").length, 31);
});

test("uses five rows for a February leap year and exposes February 29", () => {
  const calendar = buildMonthlyCalendar({ year: 2024, month: 2 });
  const leapDay = cells(calendar).find((cell) => cell.isoDate === "2024-02-29");

  assert.equal(calendar.weeks.length, 5);
  assert.deepEqual(leapDay, {
    isoDate: "2024-02-29",
    membership: "current",
    dayNumber: 29,
    weekdayIndex: 3,
  });
});

test("keeps even a 28-day Monday-start month in a five-row matrix", () => {
  const calendar = buildMonthlyCalendar({ year: 2021, month: 2 });

  assert.equal(calendar.weeks.length, 5);
  assert.equal(calendar.weeks[4][6].isoDate, "2021-03-07");
});

test("applies Gregorian century leap-year rules without host date arithmetic", () => {
  const nonLeapCentury = buildMonthlyCalendar({ year: 1900, month: 2 });
  const leapCentury = buildMonthlyCalendar({ year: 2000, month: 2 });

  assert.equal(cells(nonLeapCentury).some((cell) => cell.isoDate === "1900-02-29"), false);
  assert.equal(cells(leapCentury).some((cell) => cell.isoDate === "2000-02-29"), true);
});

test("attaches only normalized verified in-month Argentine national holidays", () => {
  const calendar = buildMonthlyCalendar(
    { year: 2024, month: 5 },
    verifiedCoverage(2024, [
      {
        date: "2024-04-29",
        label: "Adjacent fixture holiday",
        classification: "inamovible",
      },
      {
        date: "2024-05-01",
        label: "Workers' Day",
        classification: "inamovible",
      },
      {
        date: "2024-05-25",
        label: "May Revolution Day",
        classification: "trasladable",
      },
    ]),
  );

  assert.equal(calendar.holidayVerification, "verified");
  assert.deepEqual(cells(calendar).find((cell) => cell.isoDate === "2024-05-01")?.holiday, {
    label: "Workers' Day",
    classification: "inamovible",
  });
  assert.deepEqual(cells(calendar).find((cell) => cell.isoDate === "2024-05-25")?.holiday, {
    label: "May Revolution Day",
    classification: "trasladable",
  });
  assert.equal(cells(calendar).find((cell) => cell.isoDate === "2024-04-29")?.holiday, undefined);
});

test("does not label holidays from unverified coverage and preserves its reason", () => {
  const calendar = buildMonthlyCalendar(
    { year: 2024, month: 5 },
    {
      verification: "unverified",
      diagnostics: [{
        code: "HOLIDAY_TRANSPORT_FAILED",
        severity: "warning",
        message: "Holiday fallback could not be retrieved.",
        path: [],
      }],
    },
  );

  assert.equal(calendar.holidayVerification, "unverified");
  assert.equal(calendar.holidayUnverifiedReason, "Holiday fallback could not be retrieved.");
  assert.equal(cells(calendar).some((cell) => cell.holiday !== undefined), false);
});

test("rejects invalid Gregorian requests and impossible verified attachments", () => {
  assert.throws(() => buildMonthlyCalendar({ year: 2024, month: 0 }), RangeError);
  assert.throws(() => buildMonthlyCalendar({ year: 0, month: 1 }), RangeError);
  assert.throws(
    () => buildMonthlyCalendar(
      { year: 2024, month: 5 },
      verifiedCoverage(2025, []),
    ),
    RangeError,
  );
  assert.throws(
    () => buildMonthlyCalendar(
      { year: 2024, month: 5 },
      verifiedCoverage(2024, [{
        date: "2024-05-01",
        label: "Not normalized",
        classification: "puente" as "inamovible",
      }]),
    ),
    RangeError,
  );
});
