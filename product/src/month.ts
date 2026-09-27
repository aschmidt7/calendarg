import type { Diagnostic } from "./contracts.ts";
import type { HolidayResolution } from "./holiday-resolver.ts";
import type {
  HolidayClassification,
  HolidayCoverage,
  NormalizedHolidayRecord,
} from "./holidays.ts";

const SPANISH_MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

const MONDAY_FIRST_WEEKDAY_HEADERS = [
  "Lun",
  "Mar",
  "Mié",
  "Jue",
  "Vie",
  "Sáb",
  "Dom",
] as const;

export interface MonthlyCalendarRequest {
  readonly year: number;
  readonly month: number;
}

export interface CalendarHoliday {
  readonly label: string;
  readonly classification: HolidayClassification;
}

export interface MonthlyCalendarCell {
  readonly isoDate: string;
  readonly membership: "current" | "adjacent";
  readonly dayNumber: number;
  readonly weekdayIndex: number;
  readonly holiday?: CalendarHoliday;
}

export interface MonthlyCalendar {
  readonly requestedYear: number;
  readonly requestedMonth: number;
  readonly heading: string;
  readonly weekdayHeaders: readonly string[];
  readonly weeks: readonly (readonly MonthlyCalendarCell[])[];
  readonly holidayVerification: "verified" | "unverified";
  readonly holidayUnverifiedReason?: string;
  readonly holidayDiagnostics: readonly Diagnostic[];
}

type GregorianDate = Readonly<{
  year: number;
  month: number;
  day: number;
}>;

const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

const assertGregorianYearMonth = (year: unknown, month: unknown): asserts year is number => {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    (year as number) < 1 ||
    (year as number) > 9999 ||
    (month as number) < 1 ||
    (month as number) > 12
  ) {
    throw new RangeError("Calendar request must contain a valid Gregorian year and month.");
  }
};

const pad = (value: number): string => value.toString().padStart(2, "0");

const toIsoDate = ({ year, month, day }: GregorianDate): string =>
  `${year.toString().padStart(4, "0")}-${pad(month)}-${pad(day)}`;

const previousDate = ({ year, month, day }: GregorianDate): GregorianDate => {
  if (day > 1) return { year, month, day: day - 1 };
  if (month > 1) return { year, month: month - 1, day: daysInMonth(year, month - 1) };
  return { year: year - 1, month: 12, day: 31 };
};

const nextDate = ({ year, month, day }: GregorianDate): GregorianDate => {
  if (day < daysInMonth(year, month)) return { year, month, day: day + 1 };
  if (month < 12) return { year, month: month + 1, day: 1 };
  return { year: year + 1, month: 1, day: 1 };
};

const mondayFirstWeekdayIndex = (year: number, month: number, day: number): number => {
  const completedYears = year - 1;
  const completedDays =
    completedYears * 365 +
    Math.floor(completedYears / 4) -
    Math.floor(completedYears / 100) +
    Math.floor(completedYears / 400);
  const daysBeforeMonth = [0, 31, isLeapYear(year) ? 60 : 59, isLeapYear(year) ? 91 : 90,
    isLeapYear(year) ? 121 : 120, isLeapYear(year) ? 152 : 151, isLeapYear(year) ? 182 : 181,
    isLeapYear(year) ? 213 : 212, isLeapYear(year) ? 244 : 243, isLeapYear(year) ? 274 : 273,
    isLeapYear(year) ? 305 : 304, isLeapYear(year) ? 335 : 334];

  return (completedDays + daysBeforeMonth[month - 1] + day - 1) % 7;
};

const isNormalizedHoliday = (
  record: NormalizedHolidayRecord,
  coverage: HolidayCoverage,
): boolean => {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(record.date);
  if (!date || Object.hasOwn(record as object, "scope")) return false;

  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  return (
    year === coverage.year &&
    month >= 1 && month <= 12 &&
    day >= 1 && day <= daysInMonth(year, month) &&
    typeof record.label === "string" &&
    record.label.trim() !== "" &&
    record.label === record.label.trim() &&
    (record.classification === "inamovible" || record.classification === "trasladable")
  );
};

const verifiedHolidays = (
  resolution: HolidayResolution,
  requestedYear: number,
): ReadonlyMap<string, CalendarHoliday> => {
  const coverage = resolution.coverage;
  if (
    !coverage ||
    coverage.year !== requestedYear ||
    coverage.scope !== "argentina-national" ||
    coverage.status !== "valid" ||
    coverage.coveredFrom !== `${requestedYear.toString().padStart(4, "0")}-01-01` ||
    coverage.coveredThrough !== `${requestedYear.toString().padStart(4, "0")}-12-31`
  ) {
    throw new RangeError("Verified holiday coverage cannot be attached to this calendar.");
  }

  const holidays = new Map<string, CalendarHoliday>();
  for (const record of coverage.holidays) {
    if (!isNormalizedHoliday(record, coverage) || holidays.has(record.date)) {
      throw new RangeError("Verified holiday coverage contains an impossible attachment.");
    }
    holidays.set(record.date, {
      label: record.label,
      classification: record.classification,
    });
  }
  return holidays;
};

const defaultUnverifiedResolution: HolidayResolution = {
  verification: "unverified",
  diagnostics: [],
};

export const buildMonthlyCalendar = (
  request: MonthlyCalendarRequest,
  holidayResolution: HolidayResolution = defaultUnverifiedResolution,
): MonthlyCalendar => {
  if (typeof request !== "object" || request === null) {
    throw new RangeError("Calendar request must contain a valid Gregorian year and month.");
  }
  const { year, month } = request;
  assertGregorianYearMonth(year, month);

  const diagnostics = Array.isArray(holidayResolution?.diagnostics)
    ? holidayResolution.diagnostics
    : [];
  const verified = holidayResolution?.verification === "verified";
  const holidays = verified ? verifiedHolidays(holidayResolution, year) : new Map<string, CalendarHoliday>();
  const firstWeekday = mondayFirstWeekdayIndex(year, month, 1);
  const rows = Math.max(5, Math.ceil((firstWeekday + daysInMonth(year, month)) / 7));
  let date: GregorianDate = { year, month, day: 1 };

  for (let index = 0; index < firstWeekday; index += 1) date = previousDate(date);

  const weeks: MonthlyCalendarCell[][] = [];
  for (let row = 0; row < rows; row += 1) {
    const week: MonthlyCalendarCell[] = [];
    for (let weekdayIndex = 0; weekdayIndex < 7; weekdayIndex += 1) {
      const isoDate = toIsoDate(date);
      const membership = date.year === year && date.month === month
        ? "current"
        : "adjacent";
      const holiday = membership === "current" ? holidays.get(isoDate) : undefined;
      week.push({
        isoDate,
        membership,
        dayNumber: date.day,
        weekdayIndex,
        ...(holiday ? { holiday } : {}),
      });
      date = nextDate(date);
    }
    weeks.push(week);
  }

  const unverifiedReason = verified
    ? undefined
    : diagnostics[0]?.message ?? "Holiday coverage is unverified.";
  return {
    requestedYear: year,
    requestedMonth: month,
    heading: `${SPANISH_MONTHS[month - 1]} ${year}`,
    weekdayHeaders: MONDAY_FIRST_WEEKDAY_HEADERS,
    weeks,
    holidayVerification: verified ? "verified" : "unverified",
    ...(unverifiedReason ? { holidayUnverifiedReason: unverifiedReason } : {}),
    holidayDiagnostics: diagnostics,
  };
};
