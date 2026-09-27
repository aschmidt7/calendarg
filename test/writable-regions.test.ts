import assert from "node:assert/strict";
import test from "node:test";

import {
  PROTECTED_WRITABLE_REGION_MINIMUMS_UM,
  WRITABLE_REGION_POLICY,
  deriveWritableRegions,
} from "../src/domain/writable-regions.ts";
import {
  PROPOSED_COMPACT_HEADER_A4_POLICY,
  deriveMonthlyCalendarLayout,
} from "../src/domain/layout-policy.ts";
import { buildMonthlyCalendar } from "../src/domain/month.ts";

const intersects = (
  left: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  right: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): boolean =>
  left.x < right.x + right.width &&
  right.x < left.x + left.width &&
  left.y < right.y + right.height &&
  right.y < left.y + left.height;

test("allocates versioned, non-overlapping annotation and protected writing geometry for active six-row cells", () => {
  const calendar = buildMonthlyCalendar({ year: 2026, month: 3 });
  const layout = deriveMonthlyCalendarLayout(calendar, PROPOSED_COMPACT_HEADER_A4_POLICY);
  const regions = deriveWritableRegions(layout, calendar);

  assert.equal(WRITABLE_REGION_POLICY.version, "1.0.0-proposed");
  assert.equal(PROTECTED_WRITABLE_REGION_MINIMUMS_UM.area, 651_834_000);
  assert.equal(regions.annotations.length, 42);
  assert.equal(regions.protectedRegions.length, 31);
  assert.deepEqual(regions.annotations[0], {
    rowIndex: 0,
    columnIndex: 0,
    dayNumberBox: { x: 11_500, y: 24_500, width: 24_142, height: 4_500 },
    holidayLabelBox: { x: 11_500, y: 29_000, width: 24_142, height: 8_000 },
    gapBox: { x: 11_500, y: 37_000, width: 24_142, height: 1_500 },
  });
  assert.deepEqual(regions.protectedRegions[0], {
    rowIndex: 0,
    columnIndex: 6,
    isoDate: "2026-03-01",
    box: { x: 174_357, y: 38_500, width: 24_143, height: 27_000 },
  });

  for (const region of regions.protectedRegions) {
    const annotation = regions.annotations.find(
      ({ rowIndex, columnIndex }) =>
        rowIndex === region.rowIndex && columnIndex === region.columnIndex,
    );
    assert.ok(annotation);
    assert.ok(region.box.width >= PROTECTED_WRITABLE_REGION_MINIMUMS_UM.width);
    assert.ok(region.box.height >= PROTECTED_WRITABLE_REGION_MINIMUMS_UM.height);
    assert.ok(region.box.width * region.box.height >= PROTECTED_WRITABLE_REGION_MINIMUMS_UM.area);
    assert.equal(intersects(region.box, annotation.dayNumberBox), false);
    assert.equal(intersects(region.box, annotation.holidayLabelBox), false);
    assert.equal(intersects(region.box, annotation.gapBox), false);
    assert.ok(region.box.x >= layout.page.safeArea.x);
    assert.ok(region.box.y >= layout.page.safeArea.y);
    assert.ok(region.box.x + region.box.width <= layout.page.safeArea.x + layout.page.safeArea.width);
    assert.ok(region.box.y + region.box.height <= layout.page.safeArea.y + layout.page.safeArea.height);
  }
});

test("retains the larger five-row protected regions while excluding adjacent dates from v1 writing targets", () => {
  const calendar = buildMonthlyCalendar({ year: 2026, month: 7 });
  const layout = deriveMonthlyCalendarLayout(calendar, PROPOSED_COMPACT_HEADER_A4_POLICY);
  const regions = deriveWritableRegions(layout, calendar);

  assert.equal(regions.protectedRegions.length, 31);
  assert.ok(regions.protectedRegions.every((region) => region.box.height === 35_800));
  assert.equal(
    regions.protectedRegions.some((region) => region.isoDate === "2026-06-29"),
    false,
  );
  assert.equal(
    regions.protectedRegions.some((region) => region.isoDate === "2026-08-01"),
    false,
  );
});

test("rejects layouts with undersized or overlapping cell geometry before allocating writing regions", () => {
  const calendar = buildMonthlyCalendar({ year: 2026, month: 3 });
  const layout = deriveMonthlyCalendarLayout(calendar, PROPOSED_COMPACT_HEADER_A4_POLICY);
  const undersizedLayout = {
    ...layout,
    cells: layout.cells.map((cell) =>
      cell.rowIndex === 0
        ? { ...cell, box: { ...cell.box, height: 40_000 } }
        : cell,
    ),
  };
  const overlappingLayout = {
    ...layout,
    cells: layout.cells.map((cell) =>
      cell.rowIndex === 0 && cell.columnIndex === 1
        ? { ...cell, box: layout.cells[0].box }
        : cell,
    ),
  };

  assert.throws(() => deriveWritableRegions(undersizedLayout, calendar), RangeError);
  assert.throws(() => deriveWritableRegions(overlappingLayout, calendar), RangeError);
});
