/**
 * Primary moon-phase calculation for Argentine local dates.
 *
 * Algorithm: Jean Meeus, "Astronomical Algorithms" (2nd ed.), chapter 49.
 * Mean phase instant plus the full 25-term periodic correction series
 * (Table 49.A for new/full, Table 49.B for quarters) and the 14 planetary
 * argument terms (A1..A14). Accuracy is within minutes of the true instant,
 * far below the calendar-day granularity of a printed monthly sheet.
 *
 * Timezone policy: Argentina has used fixed UTC-3 (no DST) since 2009, so the
 * offset is a compile-time constant and no tzdb dependency is required. A
 * phase instant is mapped to its local calendar date before anything is
 * printed; the printed glyph only ever means "this phase fell on this
 * Argentine local date".
 *
 * Reference data: Servicio de Hidrografía Naval (Argentine Navy) lunar phase
 * tables 2024-2026 in Hora Oficial Argentina, used as regression fixtures in
 * test/moon.test.ts.
 */

const MEAN_PHASE_JD0 = 2451550.09766;
const SYNODIC_MONTH_DAYS = 29.530588861;
const SYNODIC_MEAN_DAYS_PER_YEAR = 12.3685;
const MONTHS_PER_YEAR = 12.3685;
const JULIAN_YEAR_DAYS = 365.25;
const J2000_JD = 2451545;
/** Fixed civil offset of Hora Oficial Argentina since 2009. */
export const ARGENTINA_UTC_OFFSET_HOURS = 3;

export const MOON_PHASE_NAMES = ["new", "first-quarter", "full", "last-quarter"] as const;

export type MoonPhaseName = (typeof MOON_PHASE_NAMES)[number];

/** Lunation offset of each primary phase inside one synodic month. */
const PHASE_LUNATION_FRACTIONS: Record<MoonPhaseName, 0 | 0.25 | 0.5 | 0.75> = {
  new: 0,
  "first-quarter": 0.25,
  full: 0.5,
  "last-quarter": 0.75,
};

export interface MoonPhaseOccurrence {
  readonly phase: MoonPhaseName;
  /** ISO date of the phase in Argentine local civil time (UTC-3). */
  readonly isoDate: string;
}

export interface MoonPhaseRequest {
  readonly year: number;
  readonly month: number;
}

const rad = (degrees: number): number => (degrees * Math.PI) / 180;
const sinDegrees = (degrees: number): number => Math.sin(rad(degrees));
const cosDegrees = (degrees: number): number => Math.cos(rad(degrees));

const isNonNegative = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const assertGregorianYearMonth: (
  year: unknown,
  month: unknown,
) => asserts year is number = (year, month) => {
  if (
    typeof year !== "number" ||
    !Number.isSafeInteger(year) ||
    year < 1 ||
    year > 9999 ||
    typeof month !== "number" ||
    !Number.isSafeInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new RangeError("Moon phase request must contain a valid Gregorian year and month.");
  }
};

/**
 * Julian Day of local civil noon (argentine equivalent) for a Gregorian date,
 * using the standard proleptic Gregorian conversion (Meeus chapter 7).
 */
const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
};

const gregorianToJulianDay = (year: number, month: number, day: number): number => {
  const a = month <= 2 ? 1 : 0;
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  // Julian Day of the date at noon UTC (Meeus 7.1), exact for a pure calendar
  // conversion; ±0.02 days of TD/UT difference is irrelevant at day granularity.
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
};

const julianDayToGregorianIsoDate = (julianDay: number): string => {
  const z = Math.floor(julianDay + 0.5);
  const alpha = Math.floor((z - 1867216.25) / 36524.25);
  const a = z >= 2299161 ? z + 1 + alpha - Math.floor(alpha / 4) : z;
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const dayOfMonth = b - d - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  const pad = (value: number, width: number): string => String(value).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(dayOfMonth, 2)}`;
};

interface PhaseAngles {
  readonly M: number;
  readonly Mm: number;
  readonly F: number;
  readonly W: number;
  readonly planetary: readonly number[];
}

/**
 * Solar anomaly M, lunar anomaly M', lunar argument of latitude F, the W
 * argument, and the planetary arguments A1..A14, in degrees
 * (Meeus 49.2-49.6 and Table 49.C).
 */
const angleArgumentsFor = (k: number, T: number): PhaseAngles => ({
  M: 2.5534 + 29.1053567 * k - 0.0000014 * T * T - 0.00000011 * T * T * T,
  Mm:
    201.5643 +
    385.81693528 * k +
    0.0107582 * T * T +
    0.00001238 * T * T * T -
    0.000000058 * T * T * T * T,
  F:
    160.7108 +
    390.67050284 * k -
    0.0016118 * T * T -
    0.00000227 * T * T * T +
    0.000000011 * T * T * T * T,
  W: 124.7746 - 1.56375588 * k + 0.0020672 * T * T + 0.00000215 * T * T * T,
  planetary: [
    299.77 + 0.107408 * k - 0.009173 * T * T, // A1
    251.88 + 0.016321 * k, // A2
    251.83 + 26.651886 * k, // A3
    349.42 + 36.412478 * k, // A4
    84.66 + 18.206239 * k, // A5
    141.74 + 53.303771 * k, // A6
    207.14 + 2.453732 * k, // A7
    154.84 + 7.30686 * k, // A8
    34.52 + 27.261239 * k, // A9
    207.19 + 0.121824 * k, // A10
    291.34 + 1.844379 * k, // A11
    161.72 + 24.198154 * k, // A12
    239.56 + 25.513099 * k, // A13
    331.55 + 3.592518 * k, // A14
  ],
});

/** Planetary magnitude coefficients, in millionths of a day (Table 49.C). */
const PLANETARY_COEFFICIENTS: readonly number[] = [
  325, 165, 164, 126, 110, 62, 60, 56, 47, 42, 40, 37, 35, 23,
];

/** Meeus 49.3: correction factor for the solar/lunar anomalies. */
const eccentricity = (T: number): number => 1 - 0.002516 * T - 0.0000074 * T * T;

const NEW_AND_FULL_TERMS = (args: PhaseAngles, T: number): readonly number[] => {
  const { M, Mm, F, W } = args;
  const E = eccentricity(T);
  const E2 = E * E;
  // Table 49.A: 25 periodic terms shared by new and full moon, each as
  // [coefficient in days, argument in degrees].
  const shared: readonly (readonly [number, number])[] = [
    [-0.4072, Mm],
    [0.17241 * E, M],
    [0.01608, 2 * Mm],
    [0.01039, 2 * F],
    [0.00739 * E, Mm - M],
    [-0.00514 * E, Mm + M],
    [0.00208 * E2, 2 * M],
    [-0.00111, Mm - 2 * F],
    [-0.00057, Mm + 2 * F],
    [0.00056 * E, 2 * Mm + M],
    [-0.00042, 3 * Mm],
    [0.00042 * E, M + 2 * F],
    [0.00038 * E, M - 2 * F],
    [-0.00024 * E, 2 * Mm - M],
    [-0.00017, W],
    [-0.00007, Mm + 2 * M],
    [0.00004, 2 * Mm - 2 * F],
    [0.00004, 3 * M],
    [0.00003, Mm + M - 2 * F],
    [0.00003, 2 * Mm + 2 * F],
    [-0.00003, Mm + M + 2 * F],
    [0.00003, Mm - M + 2 * F],
    [-0.00002, Mm - M - 2 * F],
    [-0.00002, 3 * Mm + M],
    [0.00002, 4 * Mm],
  ];
  return shared.map(([coefficient, angle]) => coefficient * sinDegrees(angle));
};

const QUARTER_TERMS = (args: PhaseAngles, T: number): readonly number[] => {
  const { M, Mm, F, W } = args;
  const E = eccentricity(T);
  const E2 = E * E;
  // Table 49.B: 25 periodic terms for first and last quarter.
  const shared: readonly (readonly [number, number])[] = [
    [-0.62801, Mm],
    [0.17172 * E, M],
    [-0.01183 * E, Mm + M],
    [0.00862, 2 * Mm],
    [0.00804, 2 * F],
    [0.00454 * E, Mm - M],
    [0.00204 * E2, 2 * M],
    [-0.0018, Mm - 2 * F],
    [-0.0007, Mm + 2 * F],
    [0.0004, 3 * Mm],
    [-0.00034 * E, 2 * Mm - M],
    [0.00032 * E, M + 2 * F],
    [0.00032 * E, M - 2 * F],
    [-0.00028 * E2, Mm + 2 * M],
    [0.00027 * E, 2 * Mm + M],
    [-0.00017, W],
    [-0.00005, Mm - M - 2 * F],
    [0.00004, 2 * Mm + 2 * F],
    [-0.00004, Mm + M + 2 * F],
    [0.00004, Mm - 2 * M],
    [0.00003, Mm + M - 2 * F],
    [0.00003, 3 * M],
    [0.00002, 2 * Mm - 2 * F],
    [0.00002, Mm - M + 2 * F],
    [-0.00002, 3 * Mm + M],
  ];
  return shared.map(([coefficient, angle]) => coefficient * sinDegrees(angle));
};

/** Meeus 49.5 (quarters): the W additive correction, in days. */
const quarterDayCorrection = (M: number, Mm: number, F: number, T: number): number =>
  0.00306 -
  0.00038 * eccentricity(T) * cosDegrees(M) +
  0.00026 * cosDegrees(Mm) -
  0.00002 * cosDegrees(Mm - M) +
  0.00002 * cosDegrees(Mm + M) +
  0.00002 * cosDegrees(2 * F);

/** Corrected phase instant in TD (≈ UT for the covered era), as a Julian Day. */
const correctedPhaseJulianDay = (kBase: number, phase: MoonPhaseName): number => {
  const k = kBase + PHASE_LUNATION_FRACTIONS[phase];
  const T = k / 1236.85;
  const meanJd =
    MEAN_PHASE_JD0 +
    SYNODIC_MONTH_DAYS * k +
    0.00015437 * T * T -
    0.00000015 * T * T * T +
    0.00000000073 * T * T * T * T;
  const args = angleArgumentsFor(k, T);
  const terms =
    phase === "new" || phase === "full" ? NEW_AND_FULL_TERMS(args, T) : QUARTER_TERMS(args, T);
  let jd = meanJd + terms.reduce((sum, term) => sum + term, 0);
  for (let i = 0; i < PLANETARY_COEFFICIENTS.length; i += 1) {
    jd += (PLANETARY_COEFFICIENTS[i]! / 1_000_000) * sinDegrees(args.planetary[i]!);
  }
  if (phase === "first-quarter") {
    jd += quarterDayCorrection(args.M, args.Mm, args.F, T);
  } else if (phase === "last-quarter") {
    jd -= quarterDayCorrection(args.M, args.Mm, args.F, T);
  }
  return jd;
};

/** Local (UTC-3) ISO date of a phase instant. */
const argentineIsoDateOf = (julianDay: number): string =>
  julianDayToGregorianIsoDate(julianDay - ARGENTINA_UTC_OFFSET_HOURS / 24);

/**
 * Candidate lunation numbers k for the four phases landing anywhere inside
 * the requested month. Consecutive primary crossings are ~7.4 days apart, so
 * scanning k in [floor(k(monthStart)) - 1 .. floor(k(monthEnd)) + 1] covers
 * every phase that can fall inside the month (a crossing just before the
 * window start or just after its end can still map into it through its
 * corrected instant).
 */
const candidateLunations = (monthStartLocalJd: number, monthEndLocalJd: number): readonly number[] => {
  const kStart = Math.floor(((monthStartLocalJd - J2000_JD) * MONTHS_PER_YEAR) / JULIAN_YEAR_DAYS) - 1;
  const kEnd = Math.ceil(((monthEndLocalJd - J2000_JD) * MONTHS_PER_YEAR) / JULIAN_YEAR_DAYS) + 1;
  const candidates: number[] = [];
  for (let k = kStart; k <= kEnd; k += 1) candidates.push(k);
  return candidates;
};

export const deriveMoonPhasesForMonth = (
  request: MoonPhaseRequest,
): readonly MoonPhaseOccurrence[] => {
  assertGregorianYearMonth(request.year, request.month);
  const { year, month } = request;
  const monthStartJd = gregorianToJulianDay(year, month, 1);
  // gregorianToJulianDay returns the Julian Day at 12:00 UT of the date;
  // Argentine local midnight of that date is (12h - UTC-3) = 9h earlier.
  const monthStartLocalJd = monthStartJd - (12 - ARGENTINA_UTC_OFFSET_HOURS) / 24;
  const monthEndLocalJd = monthStartLocalJd + daysInMonth(year, month);
  const monthPrefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-`;

  const occurrenceMap = new Map<string, MoonPhaseOccurrence>();
  for (const phase of MOON_PHASE_NAMES) {
    for (const k of candidateLunations(monthStartLocalJd, monthEndLocalJd)) {
      const jd = correctedPhaseJulianDay(k, phase);
      const localJd = jd - ARGENTINA_UTC_OFFSET_HOURS / 24;
      if (localJd < monthStartLocalJd || localJd >= monthEndLocalJd) continue;
      const isoDate = argentineIsoDateOf(jd);
      if (!isoDate.startsWith(monthPrefix)) continue;
      // At most one primary phase per calendar date by construction
      // (consecutive primary crossings are ~7.4 days apart); the map also
      // guards against any boundary double-write.
      occurrenceMap.set(isoDate, { phase, isoDate });
    }
  }
  return [...occurrenceMap.values()].sort((left, right) =>
    left.isoDate.localeCompare(right.isoDate),
  );
};
