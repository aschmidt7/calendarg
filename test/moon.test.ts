import assert from "node:assert/strict";
import test from "node:test";

import {
  ARGENTINA_UTC_OFFSET_HOURS,
  deriveMoonPhasesForMonth,
  MOON_PHASE_NAMES,
  type MoonPhaseName,
} from "../src/domain/moon.ts";

/** One primary moon-phase event verbatim from an Argentine official source. */
interface PhaseEventFixture {
  readonly isoDate: string;
  readonly phase: MoonPhaseName;
  /** Local (UTC-3) hour of the event, used to pick sharpest boundary cases. */
  readonly localHour: string;
}

/**
 * Primary lunar phase regression fixtures in Argentine Official Time
 * (Hora Oficial Argentina, fixed UTC-3, no DST), from the Servicio de
 * Hidrografía Naval (SHN), Argentine Navy observatory:
 * https://www.hidro.gov.ar/Observatorio/Astronomia.asp?op=5
 * Retrieved 2026-11-27. Event days are the regression fixtures (S3); the
 * `localHour` strings document the source instant and are not asserted.
 */
const SHN_FIXTURES_2024_2026: readonly PhaseEventFixture[] = [

  // 2024 events
  { isoDate: "2024-01-04", phase: "last-quarter", localHour: "00:30" },
  { isoDate: "2024-01-11", phase: "new", localHour: "08:57" },
  { isoDate: "2024-01-18", phase: "first-quarter", localHour: "00:53" },
  { isoDate: "2024-01-25", phase: "full", localHour: "14:54" },
  { isoDate: "2024-02-02", phase: "last-quarter", localHour: "20:18" },
  { isoDate: "2024-02-09", phase: "new", localHour: "19:59" },
  { isoDate: "2024-02-16", phase: "first-quarter", localHour: "12:01" },
  { isoDate: "2024-02-24", phase: "full", localHour: "09:30" },
  { isoDate: "2024-03-03", phase: "last-quarter", localHour: "12:23" },
  { isoDate: "2024-03-10", phase: "new", localHour: "06:00" },
  { isoDate: "2024-03-17", phase: "first-quarter", localHour: "01:11" },
  { isoDate: "2024-03-25", phase: "full", localHour: "04:00" },
  { isoDate: "2024-04-02", phase: "last-quarter", localHour: "00:15" },
  { isoDate: "2024-04-08", phase: "new", localHour: "15:21" },
  { isoDate: "2024-04-15", phase: "first-quarter", localHour: "16:13" },
  { isoDate: "2024-04-23", phase: "full", localHour: "20:49" },
  { isoDate: "2024-05-01", phase: "last-quarter", localHour: "08:27" },
  { isoDate: "2024-05-08", phase: "new", localHour: "00:22" },
  { isoDate: "2024-05-15", phase: "first-quarter", localHour: "08:48" },
  { isoDate: "2024-05-23", phase: "full", localHour: "10:53" },
  { isoDate: "2024-05-30", phase: "last-quarter", localHour: "14:13" },
  { isoDate: "2024-06-06", phase: "new", localHour: "09:38" },
  { isoDate: "2024-06-14", phase: "first-quarter", localHour: "02:18" },
  { isoDate: "2024-06-21", phase: "full", localHour: "22:08" },
  { isoDate: "2024-06-28", phase: "last-quarter", localHour: "18:53" },
  { isoDate: "2024-07-05", phase: "new", localHour: "19:57" },
  { isoDate: "2024-07-13", phase: "first-quarter", localHour: "19:49" },
  { isoDate: "2024-07-21", phase: "full", localHour: "07:17" },
  { isoDate: "2024-07-27", phase: "last-quarter", localHour: "23:51" },
  { isoDate: "2024-08-04", phase: "new", localHour: "08:13" },
  { isoDate: "2024-08-12", phase: "first-quarter", localHour: "12:19" },
  { isoDate: "2024-08-19", phase: "full", localHour: "15:26" },
  { isoDate: "2024-08-26", phase: "last-quarter", localHour: "06:26" },
  { isoDate: "2024-09-02", phase: "new", localHour: "22:55" },
  { isoDate: "2024-09-11", phase: "first-quarter", localHour: "03:06" },
  { isoDate: "2024-09-17", phase: "full", localHour: "23:34" },
  { isoDate: "2024-09-24", phase: "last-quarter", localHour: "15:50" },
  { isoDate: "2024-10-02", phase: "new", localHour: "15:49" },
  { isoDate: "2024-10-10", phase: "first-quarter", localHour: "15:55" },
  { isoDate: "2024-10-17", phase: "full", localHour: "08:26" },
  { isoDate: "2024-10-24", phase: "last-quarter", localHour: "05:03" },
  { isoDate: "2024-11-01", phase: "new", localHour: "09:47" },
  { isoDate: "2024-11-09", phase: "first-quarter", localHour: "02:55" },
  { isoDate: "2024-11-15", phase: "full", localHour: "18:28" },
  { isoDate: "2024-11-22", phase: "last-quarter", localHour: "22:28" },
  { isoDate: "2024-12-01", phase: "new", localHour: "03:21" },
  { isoDate: "2024-12-08", phase: "first-quarter", localHour: "12:27" },
  { isoDate: "2024-12-15", phase: "full", localHour: "06:02" },
  { isoDate: "2024-12-22", phase: "last-quarter", localHour: "19:18" },
  { isoDate: "2024-12-30", phase: "new", localHour: "19:27" },

  // 2025 events
  { isoDate: "2025-01-06", phase: "first-quarter", localHour: "20:56" },
  { isoDate: "2025-01-13", phase: "full", localHour: "19:27" },
  { isoDate: "2025-01-21", phase: "last-quarter", localHour: "17:31" },
  { isoDate: "2025-01-29", phase: "new", localHour: "09:36" },
  { isoDate: "2025-02-05", phase: "first-quarter", localHour: "05:02" },
  { isoDate: "2025-02-12", phase: "full", localHour: "10:53" },
  { isoDate: "2025-02-20", phase: "last-quarter", localHour: "14:32" },
  { isoDate: "2025-02-27", phase: "new", localHour: "21:45" },
  { isoDate: "2025-03-06", phase: "first-quarter", localHour: "13:32" },
  { isoDate: "2025-03-14", phase: "full", localHour: "03:55" },
  { isoDate: "2025-03-22", phase: "last-quarter", localHour: "08:29" },
  { isoDate: "2025-03-29", phase: "new", localHour: "07:58" },
  { isoDate: "2025-04-04", phase: "first-quarter", localHour: "23:15" },
  { isoDate: "2025-04-12", phase: "full", localHour: "21:22" },
  { isoDate: "2025-04-20", phase: "last-quarter", localHour: "22:35" },
  { isoDate: "2025-04-27", phase: "new", localHour: "16:31" },
  { isoDate: "2025-05-04", phase: "first-quarter", localHour: "10:52" },
  { isoDate: "2025-05-12", phase: "full", localHour: "13:56" },
  { isoDate: "2025-05-20", phase: "last-quarter", localHour: "08:59" },
  { isoDate: "2025-05-27", phase: "new", localHour: "00:02" },
  { isoDate: "2025-06-03", phase: "first-quarter", localHour: "00:41" },
  { isoDate: "2025-06-11", phase: "full", localHour: "04:44" },
  { isoDate: "2025-06-18", phase: "last-quarter", localHour: "16:19" },
  { isoDate: "2025-06-25", phase: "new", localHour: "07:32" },
  { isoDate: "2025-07-02", phase: "first-quarter", localHour: "16:30" },
  { isoDate: "2025-07-10", phase: "full", localHour: "17:37" },
  { isoDate: "2025-07-17", phase: "last-quarter", localHour: "21:38" },
  { isoDate: "2025-07-24", phase: "new", localHour: "16:11" },
  { isoDate: "2025-08-01", phase: "first-quarter", localHour: "09:41" },
  { isoDate: "2025-08-09", phase: "full", localHour: "04:55" },
  { isoDate: "2025-08-16", phase: "last-quarter", localHour: "02:12" },
  { isoDate: "2025-08-23", phase: "new", localHour: "03:06" },
  { isoDate: "2025-08-31", phase: "first-quarter", localHour: "03:25" },
  { isoDate: "2025-09-07", phase: "full", localHour: "15:09" },
  { isoDate: "2025-09-14", phase: "last-quarter", localHour: "07:33" },
  { isoDate: "2025-09-21", phase: "new", localHour: "16:54" },
  { isoDate: "2025-09-29", phase: "first-quarter", localHour: "20:54" },
  { isoDate: "2025-10-07", phase: "full", localHour: "00:47" },
  { isoDate: "2025-10-13", phase: "last-quarter", localHour: "15:13" },
  { isoDate: "2025-10-21", phase: "new", localHour: "09:25" },
  { isoDate: "2025-10-29", phase: "first-quarter", localHour: "13:21" },
  { isoDate: "2025-11-05", phase: "full", localHour: "10:19" },
  { isoDate: "2025-11-12", phase: "last-quarter", localHour: "02:28" },
  { isoDate: "2025-11-20", phase: "new", localHour: "03:47" },
  { isoDate: "2025-11-28", phase: "first-quarter", localHour: "03:59" },
  { isoDate: "2025-12-04", phase: "full", localHour: "20:14" },
  { isoDate: "2025-12-11", phase: "last-quarter", localHour: "17:52" },
  { isoDate: "2025-12-19", phase: "new", localHour: "22:43" },
  { isoDate: "2025-12-27", phase: "first-quarter", localHour: "16:10" },

  // 2026 events
  { isoDate: "2026-01-03", phase: "full", localHour: "07:03" },
  { isoDate: "2026-01-10", phase: "last-quarter", localHour: "12:48" },
  { isoDate: "2026-01-18", phase: "new", localHour: "16:52" },
  { isoDate: "2026-01-26", phase: "first-quarter", localHour: "01:47" },
  { isoDate: "2026-02-01", phase: "full", localHour: "19:09" },
  { isoDate: "2026-02-09", phase: "last-quarter", localHour: "09:43" },
  { isoDate: "2026-02-17", phase: "new", localHour: "09:01" },
  { isoDate: "2026-02-24", phase: "first-quarter", localHour: "09:27" },
  { isoDate: "2026-03-03", phase: "full", localHour: "08:38" },
  { isoDate: "2026-03-11", phase: "last-quarter", localHour: "06:38" },
  { isoDate: "2026-03-18", phase: "new", localHour: "22:23" },
  { isoDate: "2026-03-25", phase: "first-quarter", localHour: "16:18" },
  { isoDate: "2026-04-01", phase: "full", localHour: "23:12" },
  { isoDate: "2026-04-10", phase: "last-quarter", localHour: "01:51" },
  { isoDate: "2026-04-17", phase: "new", localHour: "08:52" },
  { isoDate: "2026-04-23", phase: "first-quarter", localHour: "23:32" },
  { isoDate: "2026-05-01", phase: "full", localHour: "14:23" },
  { isoDate: "2026-05-09", phase: "last-quarter", localHour: "18:10" },
  { isoDate: "2026-05-16", phase: "new", localHour: "17:01" },
  { isoDate: "2026-05-23", phase: "first-quarter", localHour: "08:11" },
  { isoDate: "2026-05-31", phase: "full", localHour: "05:45" },
  { isoDate: "2026-06-08", phase: "last-quarter", localHour: "07:00" },
  { isoDate: "2026-06-14", phase: "new", localHour: "23:54" },
  { isoDate: "2026-06-21", phase: "first-quarter", localHour: "18:55" },
  { isoDate: "2026-06-29", phase: "full", localHour: "20:56" },
  { isoDate: "2026-07-07", phase: "last-quarter", localHour: "16:29" },
  { isoDate: "2026-07-14", phase: "new", localHour: "06:43" },
  { isoDate: "2026-07-21", phase: "first-quarter", localHour: "08:05" },
  { isoDate: "2026-07-29", phase: "full", localHour: "11:36" },
  { isoDate: "2026-08-05", phase: "last-quarter", localHour: "23:21" },
  { isoDate: "2026-08-12", phase: "new", localHour: "14:37" },
  { isoDate: "2026-08-19", phase: "first-quarter", localHour: "23:46" },
  { isoDate: "2026-08-28", phase: "full", localHour: "01:18" },
  { isoDate: "2026-09-04", phase: "last-quarter", localHour: "04:51" },
  { isoDate: "2026-09-11", phase: "new", localHour: "00:27" },
  { isoDate: "2026-09-18", phase: "first-quarter", localHour: "17:44" },
  { isoDate: "2026-09-26", phase: "full", localHour: "13:49" },
  { isoDate: "2026-10-03", phase: "last-quarter", localHour: "10:25" },
  { isoDate: "2026-10-10", phase: "new", localHour: "12:50" },
  { isoDate: "2026-10-18", phase: "first-quarter", localHour: "13:12" },
  { isoDate: "2026-10-26", phase: "full", localHour: "01:12" },
  { isoDate: "2026-11-01", phase: "last-quarter", localHour: "17:28" },
  { isoDate: "2026-11-09", phase: "new", localHour: "04:02" },
  { isoDate: "2026-11-17", phase: "first-quarter", localHour: "08:48" },
  { isoDate: "2026-11-24", phase: "full", localHour: "11:53" },
  { isoDate: "2026-12-01", phase: "last-quarter", localHour: "03:08" },
  { isoDate: "2026-12-08", phase: "new", localHour: "21:52" },
  { isoDate: "2026-12-17", phase: "first-quarter", localHour: "02:42" },
  { isoDate: "2026-12-23", phase: "full", localHour: "22:28" },
  { isoDate: "2026-12-30", phase: "last-quarter", localHour: "15:59" },
];

const eventsByMonth = new Map<string, PhaseEventFixture[]>();
for (const event of SHN_FIXTURES_2024_2026) {
  const key = event.isoDate.slice(0, 7);
  const list = eventsByMonth.get(key) ?? [];
  list.push(event);
  eventsByMonth.set(key, list);
}

const monthKeys = [...eventsByMonth.keys()].sort();

test("phase names are only the four primary phases", () => {
  assert.deepEqual([...MOON_PHASE_NAMES], [
    "new",
    "first-quarter",
    "full",
    "last-quarter",
  ]);
});

test("fixed Argentina offset is UTC-3", () => {
  assert.equal(ARGENTINA_UTC_OFFSET_HOURS, 3);
});

test("derives every SHN fixture event on its exact local calendar date", () => {
  for (const monthKey of monthKeys) {
    const year = Number(monthKey.slice(0, 4));
    const month = Number(monthKey.slice(5, 7));
    const expected = new Map(eventsByMonth.get(monthKey)!.map((e) => [e.isoDate, e.phase]));
    const occurrences = deriveMoonPhasesForMonth({ year, month });
    const actual = new Map(occurrences.map((o) => [o.isoDate, o.phase]));
    assert.deepEqual(
      actual,
      expected,
      `Month ${monthKey}: computed phases must match SHN almanac`,
    );
    assert.equal(occurrences.length, expected.size, `Month ${monthKey}: no extra events`);
  }
});

test("at most one phase per calendar date and every date is in the requested month", () => {
  const seen = new Set<string>();
  for (const monthKey of monthKeys) {
    const year = Number(monthKey.slice(0, 4));
    const month = Number(monthKey.slice(5, 7));
    for (const occurrence of deriveMoonPhasesForMonth({ year, month })) {
      assert.ok(occurrence.isoDate.startsWith(monthKey), occurrence.isoDate);
      assert.ok(!seen.has(occurrence.isoDate), occurrence.isoDate);
      seen.add(occurrence.isoDate);
    }
  }
});

test("sharpest local-midnight boundary cases land on the printed day", () => {
  // 2025-05-27 00:02 local: phase fell two minutes after local midnight.
  const may2025 = new Map(
    deriveMoonPhasesForMonth({ year: 2025, month: 5 }).map((o) => [o.isoDate, o.phase]),
  );
  assert.equal(may2025.get("2025-05-27"), "new");
  // 2024-01-18 00:53 local.
  const jan2024 = new Map(
    deriveMoonPhasesForMonth({ year: 2024, month: 1 }).map((o) => [o.isoDate, o.phase]),
  );
  assert.equal(jan2024.get("2024-01-18"), "first-quarter");
});

test("deterministic: same request yields identical output", () => {
  const a = deriveMoonPhasesForMonth({ year: 2024, month: 1 });
  const b = deriveMoonPhasesForMonth({ year: 2024, month: 1 });
  assert.deepEqual(a, b);
});

test("rejects invalid Gregorian year and month requests", () => {
  assert.throws(() => deriveMoonPhasesForMonth({ year: 0, month: 1 }), RangeError);
  assert.throws(() => deriveMoonPhasesForMonth({ year: 10000, month: 1 }), RangeError);
  assert.throws(() => deriveMoonPhasesForMonth({ year: 2024, month: 0 }), RangeError);
  assert.throws(() => deriveMoonPhasesForMonth({ year: 2024, month: 13 }), RangeError);
});
