import {
  ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
  V1_TEMPLATE,
  type Diagnostic,
  type GenerationRequest,
  type RequestValidationResult,
} from "../contracts.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const error = (
  code: string,
  message: string,
  path: readonly string[],
): Diagnostic => ({ code, severity: "error", message, path });

export const validateGenerationRequest = (
  input: unknown,
): RequestValidationResult<GenerationRequest> => {
  if (!isRecord(input)) {
    return {
      ok: false,
      diagnostics: [
        error("INVALID_REQUEST", "Generation request must be an object.", []),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const { year, month, template, holidayScope } = input;

  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    diagnostics.push(
      error(
        "INVALID_GREGORIAN_YEAR",
        "Year must be an integer from 1 through 9999.",
        ["year"],
      ),
    );
  }

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    diagnostics.push(
      error(
        "INVALID_GREGORIAN_MONTH",
        "Month must be an integer from 1 through 12.",
        ["month"],
      ),
    );
  }

  if (template !== V1_TEMPLATE) {
    diagnostics.push(
      error(
        "UNSUPPORTED_TEMPLATE",
        `Template must be ${V1_TEMPLATE}.`,
        ["template"],
      ),
    );
  }

  if (holidayScope !== ARGENTINE_NATIONAL_HOLIDAY_SCOPE) {
    diagnostics.push(
      error(
        "UNSUPPORTED_HOLIDAY_SCOPE",
        `Holiday scope must be ${ARGENTINE_NATIONAL_HOLIDAY_SCOPE}.`,
        ["holidayScope"],
      ),
    );
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    value: {
      year: year as number,
      month: month as number,
      template: V1_TEMPLATE,
      holidayScope: ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
    },
    diagnostics: [],
  };
};
