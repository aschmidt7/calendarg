import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLayoutDocument,
  DEJAVU_SANS_FONT_TOKEN,
  validateLayoutDocument,
  type LayoutDocument,
} from "../src/rendering/layout-ir.ts";
import {
  deriveMonthlyCalendarLayout,
  PROPOSED_COMPACT_HEADER_A4_POLICY,
} from "../src/domain/layout-policy.ts";
import { buildMonthlyCalendar } from "../src/domain/month.ts";
import { deriveWritableRegions } from "../src/domain/writable-regions.ts";
import type { PhysicalBox } from "../src/domain/layout-policy.ts";
import type { HolidayResolution } from "../src/application/holiday-resolver.ts";
import type { HolidayCoverage } from "../src/domain/holidays.ts";

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

const isInside = (inner: PhysicalBox, outer: PhysicalBox): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

const overlaps = (left: PhysicalBox, right: PhysicalBox): boolean =>
  left.x < right.x + right.width &&
  right.x < left.x + left.width &&
  left.y < right.y + right.height &&
  right.y < left.y + left.height;

const buildDocument = (holidayResolution?: HolidayResolution): LayoutDocument => {
  const calendar = buildMonthlyCalendar(
    { year: 2024, month: 5 },
    holidayResolution,
  );
  const layout = deriveMonthlyCalendarLayout(calendar, PROPOSED_COMPACT_HEADER_A4_POLICY);
  return buildLayoutDocument(calendar, layout, deriveWritableRegions(layout, calendar));
};

test("builds a frozen v1 canonical document in stable paint order", () => {
  const document = buildDocument(verifiedCoverage(2024, [{
    date: "2024-05-01",
    label: "Workers' Day",
    classification: "inamovible",
  }]));
  const roles = document.elements.map((element) => element.role);
  const cellCount = 35;

  assert.equal(document.version, "1.0.0");
  assert.equal(document.templateId, "monthly-calendar-a4-vertical-v1");
  assert.deepEqual(document.page, { width: 210_000, height: 297_000 });
  assert.deepEqual(document.safeArea, { x: 10_000, y: 10_000, width: 190_000, height: 277_000 });
  assert.deepEqual(roles.slice(0, 2 + cellCount), ["page", "grid", ...Array(cellCount).fill("cell")]);
  assert.deepEqual(roles.slice(2 + cellCount, 10 + cellCount), [
    "heading",
    ...Array(7).fill("weekday-header"),
  ]);
  assert.deepEqual(
    document.elements.map((element) => element.z),
    Array.from({ length: document.elements.length }, (_value, index) => index),
  );
  assert.equal(new Set(document.elements.map((element) => element.id)).size, document.elements.length);
  assert.equal(document.elements.find((element) => element.id === "day-number-0-2")?.role, "day-number");
  assert.equal(document.elements.find((element) => element.id === "holiday-label-0-2-0")?.fontToken, DEJAVU_SANS_FONT_TOKEN);
  const heading = document.elements.find((element) => element.role === "heading");
  const weekdays = document.elements.filter((element) => element.role === "weekday-header");
  const firstDay = document.elements.find((element) => element.id === "adjacent-day-number-0-0");
  const firstCell = document.elements.find((element) => element.id === "cell-0-0");
  if (!heading || heading.kind !== "text" || !firstDay || firstDay.kind !== "text" || !firstCell) {
    throw new Error("Expected canonical text alignment fixtures.");
  }
  assert.deepEqual(
    { textAnchor: heading.textAnchor, dominantBaseline: heading.dominantBaseline },
    { textAnchor: "middle", dominantBaseline: "middle" },
  );
  assert.equal(weekdays.length, 7);
  assert.ok(weekdays.every((weekday) =>
    weekday.kind === "text" && weekday.textAnchor === "middle" && weekday.dominantBaseline === "middle",
  ));
  assert.equal(heading.fontSizeUm, 5_000);
  assert.ok(weekdays.every((weekday) => weekday.kind === "text" && weekday.fontSizeUm === 3_000));
  assert.equal(firstDay.fontSizeUm, 4_200);
  assert.equal(document.elements.find((element) => element.id === "day-number-0-2")?.fontSizeUm, 4_200);
  assert.deepEqual(
    { textAnchor: firstDay.textAnchor, dominantBaseline: firstDay.dominantBaseline },
    { textAnchor: "start", dominantBaseline: "hanging" },
  );
  assert.equal(firstDay.box.y, firstCell.box.y + 1_500);
  assert.ok(firstDay.box.y > firstCell.box.y);
  assert.deepEqual(document.elements.find((element) => element.role === "grid")?.box, {
    x: 10_000,
    y: 23_000,
    width: 190_000,
    height: 264_000,
  });
  assert.deepEqual(heading.box, { x: 10_000, y: 10_000, width: 190_000, height: 8_000 });
  assert.deepEqual(weekdays[0]?.box, { x: 10_000, y: 18_000, width: 27_142, height: 5_000 });
  assert.equal(document.protectedRegions.length, 31);
  assert.ok(Object.isFrozen(document));
  assert.ok(Object.isFrozen(document.elements));
  assert.throws(() => (document.elements as unknown as { push: (value: unknown) => void }).push({}), TypeError);
});

test("assigns the stable secondary style only to adjacent-month day numbers", () => {
  const document = buildDocument();
  const adjacentDay = document.elements.find((element) => element.role === "adjacent-day-number");
  const currentDay = document.elements.find((element) => element.role === "day-number");
  const heading = document.elements.find((element) => element.role === "heading");
  const weekday = document.elements.find((element) => element.role === "weekday-header");

  if (!adjacentDay || !currentDay || !heading || !weekday) {
    throw new Error("Expected day and header text fixtures.");
  }
  assert.equal((adjacentDay as { styleToken?: string }).styleToken, "adjacent-day-gray");
  assert.equal((currentDay as { styleToken?: string }).styleToken, "black");
  assert.equal((heading as { styleToken?: string }).styleToken, "black");
  assert.equal((weekday as { styleToken?: string }).styleToken, "black");

  const invalidStyle = structuredClone(document) as LayoutDocument;
  const invalidAdjacentDay = invalidStyle.elements.find((element) => element.role === "adjacent-day-number");
  if (!invalidAdjacentDay) throw new Error("Missing adjacent-day fixture.");
  (invalidAdjacentDay as { styleToken: string }).styleToken = "black";
  assert.throws(() => validateLayoutDocument(invalidStyle), /style/i);
});

test("adds holiday labels only for current verified cells and adjacent numbers only for adjacent dates", () => {
  const document = buildDocument(verifiedCoverage(2024, [
    { date: "2024-04-29", label: "Adjacent holiday", classification: "inamovible" },
    { date: "2024-05-01", label: "Workers' Day", classification: "inamovible" },
  ]));

  assert.equal(document.elements.some((element) => element.id === "holiday-label-0-0"), false);
  assert.equal(document.elements.some((element) => element.id === "holiday-label-0-2-0"), true);
  assert.equal(document.elements.some((element) => element.id === "adjacent-day-number-0-0"), true);
  assert.equal(document.elements.some((element) => element.id === "day-number-0-0"), false);

  const unverified = buildDocument();
  assert.equal(unverified.elements.some((element) => element.role === "holiday-label"), false);
});

test("fits long verified holiday labels into one or two ordered annotation lines", () => {
  const label = "National Commemoration of an Exceptionally Long Historic and Cultural Anniversary";
  const calendar = buildMonthlyCalendar(
    { year: 2024, month: 5 },
    verifiedCoverage(2024, [{
      date: "2024-05-01",
      label,
      classification: "inamovible",
    }]),
  );
  const layout = deriveMonthlyCalendarLayout(calendar, PROPOSED_COMPACT_HEADER_A4_POLICY);
  const writableRegions = deriveWritableRegions(layout, calendar);
  const document = buildLayoutDocument(calendar, layout, writableRegions);
  const holidayLines = document.elements.filter((element) =>
    element.role === "holiday-label" && element.rowIndex === 0 && element.columnIndex === 2,
  );
  const annotationBox = writableRegions.annotations.find((annotation) =>
    annotation.rowIndex === 0 && annotation.columnIndex === 2,
  )?.holidayLabelBox;
  const protectedBox = document.protectedRegions.find((region) =>
    region.rowIndex === 0 && region.columnIndex === 2,
  )?.box;

  if (!annotationBox || !protectedBox) throw new Error("Missing current-cell allocation fixtures.");
  assert.ok(holidayLines.length >= 1 && holidayLines.length <= 2);
  assert.ok(holidayLines.every((line) => line.kind === "text"));
  assert.deepEqual(holidayLines.map((line) => line.id), holidayLines.map((_line, index) => `holiday-label-0-2-${index}`));
  assert.deepEqual(holidayLines.map((line) => (line as { lineIndex: number }).lineIndex), [
    ...holidayLines.keys(),
  ]);
  assert.ok(holidayLines.every((line) => (line as { fontSizeUm: number }).fontSizeUm >= 2_116));
  assert.ok(holidayLines.every((line) => (line as { truncated: boolean }).truncated));
  assert.ok(holidayLines.some((line) => line.kind === "text" && line.text.includes("…")));
  assert.ok(holidayLines.every((line) => isInside(line.box, annotationBox)));
  assert.ok(holidayLines.every((line) => !overlaps(line.box, protectedBox)));
  assert.ok(document.diagnostics.some((diagnostic) => diagnostic.code === "holiday-label-truncated"));
  assert.ok(document.diagnostics.every((diagnostic) => !Object.hasOwn(diagnostic, "originalLabel")));

  const malformedLine = structuredClone(document) as LayoutDocument;
  const malformed = malformedLine.elements.find((element) => element.id === "holiday-label-0-2-0");
  if (!malformed) throw new Error("Missing holiday label line fixture.");
  (malformed as { lineIndex: number }).lineIndex = 2;
  assert.throws(() => validateLayoutDocument(malformedLine), /holiday label/i);
});

test("rejects malformed documents, illegal roles, and overlapping protected regions", () => {
  const document = buildDocument();

  const illegalRole = structuredClone(document) as LayoutDocument;
  (illegalRole.elements[0] as { role: string }).role = "moon";
  assert.throws(() => validateLayoutDocument(illegalRole), /role/i);

  const malformedPage = structuredClone(document) as LayoutDocument;
  (malformedPage.page as { width: number }).width = 1;
  assert.throws(() => validateLayoutDocument(malformedPage), /A4/i);

  const outsideSafeArea = structuredClone(document) as LayoutDocument;
  const heading = outsideSafeArea.elements.find((element) => element.role === "heading");
  if (!heading) throw new Error("Missing heading element");
  (heading.box as { x: number }).x = 0;
  assert.throws(() => validateLayoutDocument(outsideSafeArea), /containment/i);

  const retiredSafeArea = structuredClone(document) as LayoutDocument;
  (retiredSafeArea as { safeArea: PhysicalBox }).safeArea = {
    x: 15_000,
    y: 15_000,
    width: 180_000,
    height: 267_000,
  };
  assert.throws(() => validateLayoutDocument(retiredSafeArea), /safe area/i);

  const overlappingProtectedRegions = structuredClone(document) as LayoutDocument;
  (overlappingProtectedRegions.protectedRegions as { id: string; box: unknown }[]).push({
    id: "protected-duplicate",
    box: overlappingProtectedRegions.protectedRegions[0].box,
  });
  assert.throws(() => validateLayoutDocument(overlappingProtectedRegions), /overlap/i);
});
