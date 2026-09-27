import assert from "node:assert/strict";
import test from "node:test";

import {
  A4_PAGE_UM,
  PROPOSED_COMPACT_HEADER_A4_POLICY,
  deriveMonthlyCalendarLayout,
} from "../src/domain/layout-policy.ts";
import { buildMonthlyCalendar } from "../src/domain/month.ts";

test("derives the exact five-row experimental 10 mm compact-header A4 template without accumulated column rounding", () => {
  const calendar = buildMonthlyCalendar({ year: 2026, month: 7 });
  const layout = deriveMonthlyCalendarLayout(calendar, PROPOSED_COMPACT_HEADER_A4_POLICY);

  assert.deepEqual(layout.page, {
    width: 210_000,
    height: 297_000,
    safeArea: { x: 10_000, y: 10_000, width: 190_000, height: 277_000 },
  });
  assert.deepEqual(A4_PAGE_UM, { width: 210_000, height: 297_000 });
  assert.deepEqual(layout.headingBox, { x: 10_000, y: 10_000, width: 190_000, height: 8_000 });
  assert.deepEqual(layout.weekdayBoxes[0], { x: 10_000, y: 18_000, width: 27_142, height: 5_000 });
  assert.deepEqual(layout.weekdayBoxes[6], { x: 172_857, y: 18_000, width: 27_143, height: 5_000 });
  assert.deepEqual(layout.gridBox, { x: 10_000, y: 23_000, width: 190_000, height: 264_000 });
  assert.equal(layout.cells.length, 35);
  assert.deepEqual(layout.cells[0], {
    rowIndex: 0,
    columnIndex: 0,
    box: { x: 10_000, y: 23_000, width: 27_142, height: 52_800 },
  });
  assert.deepEqual(layout.cells.at(-1), {
    rowIndex: 4,
    columnIndex: 6,
    box: { x: 172_857, y: 234_200, width: 27_143, height: 52_800 },
  });
  assert.equal(layout.cells[0].box.x, layout.gridBox.x);
  assert.equal(layout.cells.at(-1)?.box.x + layout.cells.at(-1)?.box.width, 200_000);
  assert.equal(layout.cells.at(-1)?.box.y + layout.cells.at(-1)?.box.height, 287_000);
});

test("derives six equal rational grid tracks from independently calculated boundaries", () => {
  const calendar = buildMonthlyCalendar({ year: 2026, month: 3 });
  const layout = deriveMonthlyCalendarLayout(calendar, PROPOSED_COMPACT_HEADER_A4_POLICY);

  assert.equal(layout.rowCount, 6);
  assert.equal(layout.columnCount, 7);
  assert.equal(layout.cells.length, 42);
  assert.deepEqual(layout.cells[0].box, { x: 10_000, y: 23_000, width: 27_142, height: 44_000 });
  assert.deepEqual(layout.cells[7].box, { x: 10_000, y: 67_000, width: 27_142, height: 44_000 });
  assert.deepEqual(layout.cells.at(-1), {
    rowIndex: 5,
    columnIndex: 6,
    box: { x: 172_857, y: 243_000, width: 27_143, height: 44_000 },
  });
  assert.equal(layout.cells.at(-1)?.box.x + layout.cells.at(-1)?.box.width, 200_000);
  assert.equal(layout.cells.at(-1)?.box.y + layout.cells.at(-1)?.box.height, 287_000);
});

test("rejects row counts outside the five-or-six-row policy and malformed weeks", () => {
  const fiveRowCalendar = buildMonthlyCalendar({ year: 2026, month: 7 });
  const fourRowCalendar = { ...fiveRowCalendar, weeks: fiveRowCalendar.weeks.slice(0, 4) };
  const malformedWeekCalendar = {
    ...fiveRowCalendar,
    weeks: [fiveRowCalendar.weeks[0].slice(0, 6), ...fiveRowCalendar.weeks.slice(1)],
  };

  assert.throws(
    () => deriveMonthlyCalendarLayout(fourRowCalendar, PROPOSED_COMPACT_HEADER_A4_POLICY),
    RangeError,
  );
  assert.throws(
    () => deriveMonthlyCalendarLayout(malformedWeekCalendar, PROPOSED_COMPACT_HEADER_A4_POLICY),
    RangeError,
  );
});

test("rejects unsafe policy geometry before deriving a calendar layout", () => {
  const calendar = buildMonthlyCalendar({ year: 2026, month: 7 });
  const unsafePolicy = {
    ...PROPOSED_COMPACT_HEADER_A4_POLICY,
    safeArea: { ...PROPOSED_COMPACT_HEADER_A4_POLICY.safeArea, x: 0 },
  };

  assert.throws(() => deriveMonthlyCalendarLayout(calendar, unsafePolicy), RangeError);
});
