import assert from "node:assert/strict";
import test from "node:test";

import {
  DETERMINISTIC_HOLIDAY_TEXT_METRICS,
  HolidayLabelLayoutError,
  MINIMUM_HOLIDAY_FONT_SIZE_UM,
  PROPOSED_HOLIDAY_FONT_SIZE_UM,
  fitHolidayLabel,
  type HolidayTextMetrics,
} from "../src/rendering/holiday-fitting.ts";

const annotationBox = {
  x: 16_500,
  y: 40_000,
  width: 22_714,
  height: 8_000,
} as const;

const unitMetrics: HolidayTextMetrics = {
  measureWidth: (text, fontSizeUm) => Array.from(text).length * fontSizeUm,
  lineHeight: (fontSizeUm) => fontSizeUm,
};

test("uses a conservative deterministic fallback that further reduces the long May 25 label inside its fixed annotation box", () => {
  const label = "Día de la Revolución de Mayo";
  const result = fitHolidayLabel({
    nodeId: "holiday-label-0-2",
    label,
    box: annotationBox,
  });

  assert.equal(DETERMINISTIC_HOLIDAY_TEXT_METRICS.measureWidth("MMMM", 3_000), 6_600);
  assert.equal(result.originalLabel, label);
  assert.deepEqual(result.box, annotationBox);
  assert.ok(result.fontSizeUm >= MINIMUM_HOLIDAY_FONT_SIZE_UM);
  assert.ok(result.fontSizeUm <= PROPOSED_HOLIDAY_FONT_SIZE_UM);
  assert.ok(result.fontSizeUm < 2_523);
  assert.equal(result.truncated, false);
  assert.ok(result.lines.length >= 1 && result.lines.length <= 2);
  assert.ok(result.lines.every((line) =>
    DETERMINISTIC_HOLIDAY_TEXT_METRICS.measureWidth(line, result.fontSizeUm) <= annotationBox.width,
  ));
  assert.deepEqual(result.diagnostics, []);
});

test("wraps at word boundaries and reduces only as far as needed, never below 6 pt", () => {
  const result = fitHolidayLabel({
    nodeId: "holiday-label-1-3",
    label: "Alfa Beta",
    box: { x: 0, y: 0, width: 10_000, height: 6_000 },
    metrics: unitMetrics,
  });

  assert.deepEqual(result.lines, ["Alfa", "Beta"]);
  assert.equal(result.fontSizeUm, 2_500);
  assert.equal(result.truncated, false);
  assert.ok(result.fontSizeUm >= 2_116);
});

test("truncates a long label visibly within a too-small box and records the original label", () => {
  const label = "Conmemoración Nacional Extraordinariamente Prolongada";
  const box = { x: 0, y: 0, width: 4_232, height: 4_232 } as const;
  const result = fitHolidayLabel({
    nodeId: "holiday-label-4-6",
    label,
    box,
    metrics: unitMetrics,
  });

  assert.equal(result.fontSizeUm, 2_116);
  assert.equal(result.truncated, true);
  assert.equal(result.originalLabel, label);
  assert.ok(result.lines.join(" ").includes("…"));
  assert.ok(result.lines.length <= 2);
  assert.ok(result.lines.every((line) => unitMetrics.measureWidth(line, result.fontSizeUm) <= box.width));
  assert.ok(unitMetrics.lineHeight(result.fontSizeUm) * result.lines.length <= box.height);
  assert.deepEqual(result.diagnostics, [{
    code: "holiday-label-truncated",
    severity: "warning",
    message: "Holiday label was truncated to fit its annotation box.",
    nodeId: "holiday-label-4-6",
    originalLabel: label,
  }]);
});

test("raises a node-specific layout error when even an ellipsis cannot fit", () => {
  assert.throws(
    () => fitHolidayLabel({
      nodeId: "holiday-label-5-0",
      label: "Día Nacional",
      box: { x: 0, y: 0, width: 2_115, height: 4_232 },
      metrics: unitMetrics,
    }),
    (error: unknown) =>
      error instanceof HolidayLabelLayoutError &&
      error.nodeId === "holiday-label-5-0" &&
      /ellipsis/i.test(error.message),
  );
});
