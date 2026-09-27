import {
  ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
  type Diagnostic,
  type HolidayScope,
} from "./contracts.ts";

export type DateOnly = string;
export type HolidayClassification = "inamovible" | "trasladable";
export type HolidayCoverageStatus = "valid" | "incomplete" | "expired" | "invalid";

type SourceHolidayClassification = HolidayClassification | "puente";

export interface HolidayProvenance {
  readonly source: string;
  readonly retrievedOn: DateOnly;
  readonly validThrough: DateOnly;
}

export interface NormalizedHolidayRecord {
  readonly date: DateOnly;
  readonly label: string;
  readonly classification: HolidayClassification;
}

export interface HolidayRecordCandidate {
  readonly date: unknown;
  readonly label: unknown;
  readonly classification: unknown;
  readonly scope: unknown;
}

export interface HolidayCoverageCandidate {
  readonly year: unknown;
  readonly scope: unknown;
  readonly coveredFrom: unknown;
  readonly coveredThrough: unknown;
  readonly provenance: unknown;
  readonly holidays: unknown;
}

export interface HolidayCoverage {
  readonly year: number;
  readonly scope: HolidayScope;
  readonly status: HolidayCoverageStatus;
  readonly coveredFrom: DateOnly;
  readonly coveredThrough: DateOnly;
  readonly provenance: HolidayProvenance;
  readonly holidays: readonly NormalizedHolidayRecord[];
}

export interface ValidHolidayCoverage {
  readonly ok: true;
  readonly value: HolidayCoverage;
  readonly diagnostics: readonly Diagnostic[];
}

export interface RejectedHolidayCoverage {
  readonly ok: false;
  readonly status: Exclude<HolidayCoverageStatus, "valid">;
  readonly diagnostics: readonly Diagnostic[];
}

export type HolidayCoverageValidationResult =
  | ValidHolidayCoverage
  | RejectedHolidayCoverage;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const error = (
  code: string,
  message: string,
  path: readonly string[],
): Diagnostic => ({ code, severity: "error", message, path });

const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const isDateOnly = (value: unknown): value is DateOnly => {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
};

const isHolidayClassification = (
  value: unknown,
): value is SourceHolidayClassification =>
  value === "inamovible" || value === "trasladable" || value === "puente";

const isFullYearCoverage = (
  year: number,
  coveredFrom: DateOnly,
  coveredThrough: DateOnly,
): boolean =>
  coveredFrom === `${year.toString().padStart(4, "0")}-01-01` &&
  coveredThrough === `${year.toString().padStart(4, "0")}-12-31`;

export const validateHolidayCoverage = (
  input: unknown,
  asOf: DateOnly,
): HolidayCoverageValidationResult => {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      status: "invalid",
      diagnostics: [
        error("INVALID_HOLIDAY_COVERAGE", "Holiday coverage must be an object.", []),
      ],
    };
  }

  const { year, scope, coveredFrom, coveredThrough, provenance, holidays } = input;
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    diagnostics.push(error("INVALID_COVERAGE_YEAR", "Coverage year must be a Gregorian year.", ["year"]));
  }
  if (scope !== ARGENTINE_NATIONAL_HOLIDAY_SCOPE) {
    diagnostics.push(error("UNSUPPORTED_HOLIDAY_SCOPE", "Coverage must be Argentine national.", ["scope"]));
  }
  if (!isDateOnly(coveredFrom)) {
    diagnostics.push(error("INVALID_COVERAGE_START", "Coverage start must be a date-only value.", ["coveredFrom"]));
  }
  if (!isDateOnly(coveredThrough)) {
    diagnostics.push(error("INVALID_COVERAGE_END", "Coverage end must be a date-only value.", ["coveredThrough"]));
  }
  if (!isDateOnly(asOf)) {
    diagnostics.push(error("INVALID_AS_OF_DATE", "Validation date must be date-only.", ["asOf"]));
  }

  let normalizedProvenance: HolidayProvenance | undefined;
  if (!isRecord(provenance)) {
    diagnostics.push(error("MISSING_PROVENANCE", "Coverage provenance is required.", ["provenance"]));
  } else {
    const { source, retrievedOn, validThrough } = provenance;
    if (typeof source !== "string" || source.trim() === "") {
      diagnostics.push(error("INVALID_PROVENANCE_SOURCE", "Provenance source must be non-empty.", ["provenance", "source"]));
    }
    if (!isDateOnly(retrievedOn)) {
      diagnostics.push(error("INVALID_PROVENANCE_RETRIEVED_ON", "Provenance retrieval date must be date-only.", ["provenance", "retrievedOn"]));
    }
    if (!isDateOnly(validThrough)) {
      diagnostics.push(error("INVALID_PROVENANCE_VALID_THROUGH", "Provenance expiry date must be date-only.", ["provenance", "validThrough"]));
    }
    if (
      typeof source === "string" &&
      source.trim() !== "" &&
      isDateOnly(retrievedOn) &&
      isDateOnly(validThrough)
    ) {
      normalizedProvenance = { source: source.trim(), retrievedOn, validThrough };
    }
  }

  const normalizedHolidays: NormalizedHolidayRecord[] = [];
  if (!Array.isArray(holidays)) {
    diagnostics.push(error("INVALID_HOLIDAY_RECORDS", "Holiday records must be an array.", ["holidays"]));
  } else {
    for (const [index, record] of holidays.entries()) {
      const path = ["holidays", String(index)];
      if (!isRecord(record)) {
        diagnostics.push(error("INVALID_HOLIDAY_RECORD", "Holiday record must be an object.", path));
        continue;
      }

      const { date, label, classification, scope: recordScope } = record as HolidayRecordCandidate;
      if (!isDateOnly(date)) {
        diagnostics.push(error("INVALID_HOLIDAY_DATE", "Holiday date must be date-only.", [...path, "date"]));
      } else if (Number(date.slice(0, 4)) !== year) {
        diagnostics.push(error("MISMATCHED_HOLIDAY_YEAR", "Holiday date must belong to coverage year.", [...path, "date"]));
      }
      if (typeof label !== "string" || label.trim() === "") {
        diagnostics.push(error("INVALID_HOLIDAY_LABEL", "Holiday label must be non-empty.", [...path, "label"]));
      }
      if (!isHolidayClassification(classification)) {
        diagnostics.push(error("UNKNOWN_HOLIDAY_CLASSIFICATION", "Holiday classification is unsupported.", [...path, "classification"]));
      }
      if (recordScope !== ARGENTINE_NATIONAL_HOLIDAY_SCOPE) {
        diagnostics.push(error("OUT_OF_SCOPE_HOLIDAY", "Holiday must be Argentine national.", [...path, "scope"]));
      }

      if (
        isDateOnly(date) &&
        Number(date.slice(0, 4)) === year &&
        typeof label === "string" &&
        label.trim() !== "" &&
        isHolidayClassification(classification) &&
        recordScope === ARGENTINE_NATIONAL_HOLIDAY_SCOPE &&
        classification !== "puente"
      ) {
        normalizedHolidays.push({
          date,
          label: label.trim(),
          classification,
        });
      }
    }
  }

  const uniqueHolidays = new Map<string, NormalizedHolidayRecord>();
  for (const holiday of normalizedHolidays) {
    const previous = uniqueHolidays.get(holiday.date);
    if (
      previous &&
      (previous.label !== holiday.label || previous.classification !== holiday.classification)
    ) {
      diagnostics.push(error("CONFLICTING_HOLIDAY_DUPLICATE", "Holiday records conflict for the same date.", ["holidays", holiday.date]));
    } else {
      uniqueHolidays.set(holiday.date, holiday);
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, status: "invalid", diagnostics };
  }

  const validYear = year as number;
  const validCoveredFrom = coveredFrom as DateOnly;
  const validCoveredThrough = coveredThrough as DateOnly;
  if (!isFullYearCoverage(validYear, validCoveredFrom, validCoveredThrough)) {
    return {
      ok: false,
      status: "incomplete",
      diagnostics: [
        error("INCOMPLETE_YEAR_COVERAGE", "Coverage must span the complete Gregorian year.", ["coveredFrom", "coveredThrough"]),
      ],
    };
  }

  if ((asOf as DateOnly) > normalizedProvenance!.validThrough) {
    return {
      ok: false,
      status: "expired",
      diagnostics: [
        error("EXPIRED_HOLIDAY_COVERAGE", "Coverage is no longer valid on the requested date.", ["provenance", "validThrough"]),
      ],
    };
  }

  return {
    ok: true,
    value: {
      year: validYear,
      scope: ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
      status: "valid",
      coveredFrom: validCoveredFrom,
      coveredThrough: validCoveredThrough,
      provenance: normalizedProvenance!,
      holidays: [...uniqueHolidays.values()].sort((left, right) => left.date.localeCompare(right.date)),
    },
    diagnostics: [],
  };
};
