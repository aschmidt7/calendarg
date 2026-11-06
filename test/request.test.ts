import assert from "node:assert/strict";
import test from "node:test";

import { validateGenerationRequest } from "../src/application/request.ts";

test("accepts the fixed v1 request", () => {
  const result = validateGenerationRequest({
    year: 2024,
    month: 2,
    template: "vertical-monthly-v1",
    holidayScope: "argentina-national",
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      year: 2024,
      month: 2,
      template: "vertical-monthly-v1",
      holidayScope: "argentina-national",
    },
    diagnostics: [],
  });
});

test("rejects invalid Gregorian month and year without defaults", () => {
  const result = validateGenerationRequest({
    year: 0,
    month: 13,
    template: "vertical-monthly-v1",
    holidayScope: "argentina-national",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["INVALID_GREGORIAN_YEAR", "INVALID_GREGORIAN_MONTH"],
  );
});

test("rejects unsupported template and holiday scope", () => {
  const result = validateGenerationRequest({
    year: 2024,
    month: 2,
    template: "horizontal-monthly-v1",
    holidayScope: "argentina-provincial",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["UNSUPPORTED_TEMPLATE", "UNSUPPORTED_HOLIDAY_SCOPE"],
  );
});

test("rejects a non-object request instead of applying defaults", () => {
  const result = validateGenerationRequest(null);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["INVALID_REQUEST"],
  );
});

test("rejects a year/month whose adjacent date would leave the supported 1-9999 range", () => {
  for (const [year, month] of [[9999, 12], [1, 1]] as const) {
    const result = validateGenerationRequest({
      year,
      month,
      template: "vertical-monthly-v1",
      holidayScope: "argentina-national",
    });

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.diagnostics.map((diagnostic) => diagnostic.code),
      ["ADJACENT_DATE_OUT_OF_RANGE"],
    );
  }
});

