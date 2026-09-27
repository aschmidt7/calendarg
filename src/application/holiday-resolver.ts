import {
  ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
  type Clock,
  type Diagnostic,
  type HolidayScope,
  type Transport,
} from "../contracts.ts";
import {
  validateHolidayCoverage,
  type DateOnly,
  type HolidayCoverage,
  type HolidayCoverageCandidate,
  type HolidayProvenance,
} from "../domain/holidays.ts";

const ARGENTINA_DATOS_URL = "https://api.argentinadatos.com/v1/feriados";

export interface HolidayCoverageStore {
  load(year: number, scope: HolidayScope): Promise<unknown | undefined>;
  commit(coverage: HolidayCoverage): Promise<void>;
}

export interface HolidayGateway {
  fetch(
    year: number,
    scope: HolidayScope,
    provenance: HolidayProvenance,
  ): Promise<HolidayCoverageCandidate>;
}

export interface HolidayResolution {
  readonly verification: "verified" | "unverified";
  readonly coverage?: HolidayCoverage;
  readonly diagnostics: readonly Diagnostic[];
}

const diagnostic = (
  code: string,
  severity: Diagnostic["severity"],
  message: string,
  path: readonly string[] = [],
): Diagnostic => ({ code, severity, message, path });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const dateOnly = (date: Date): DateOnly | undefined => {
  const time = date.getTime();
  if (Number.isNaN(time)) return undefined;

  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
};

const yearEnd = (year: number): DateOnly =>
  `${year.toString().padStart(4, "0")}-12-31`;

const coverageValidationDate = (year: number, today: DateOnly): DateOnly => {
  const requestedYearEnd = yearEnd(year);
  return requestedYearEnd < today ? requestedYearEnd : today;
};

const rehydrateCoverageCandidate = (coverage: unknown): unknown => {
  if (!isRecord(coverage) || !Array.isArray(coverage.holidays)) return coverage;

  return {
    ...coverage,
    holidays: coverage.holidays.map((holiday) =>
      isRecord(holiday)
        ? { ...holiday, scope: ARGENTINE_NATIONAL_HOLIDAY_SCOPE }
        : holiday,
    ),
  };
};

export class ArgentinaDatosHolidayGateway implements HolidayGateway {
  private readonly transport: Transport<string, unknown>;

  constructor(transport: Transport<string, unknown>) {
    this.transport = transport;
  }

  async fetch(
    year: number,
    scope: HolidayScope,
    provenance: HolidayProvenance,
  ): Promise<HolidayCoverageCandidate> {
    const response = await this.transport.send(`${ARGENTINA_DATOS_URL}/${year}`);

    return {
      year,
      scope,
      coveredFrom: `${year.toString().padStart(4, "0")}-01-01`,
      coveredThrough: `${year.toString().padStart(4, "0")}-12-31`,
      provenance,
      holidays: Array.isArray(response)
        ? response.map((record) => {
          if (!isRecord(record)) return record;
          return {
            date: record.fecha,
            classification: record.tipo,
            label: record.nombre,
            scope,
          };
        })
        : response,
    };
  }
}

export class HolidayResolver {
  private readonly store: HolidayCoverageStore;
  private readonly gateway: HolidayGateway;
  private readonly clock: Clock;

  constructor(
    store: HolidayCoverageStore,
    gateway: HolidayGateway,
    clock: Clock,
  ) {
    this.store = store;
    this.gateway = gateway;
    this.clock = clock;
  }

  async resolve(year: number, scope: HolidayScope): Promise<HolidayResolution> {
    const diagnostics: Diagnostic[] = [];
    const today = this.currentDate(diagnostics);
    if (!today) return this.unverified(diagnostics);

    const validationDate = coverageValidationDate(year, today);
    const local = await this.loadLocal(year, scope, validationDate, diagnostics);
    if (local) {
      return { verification: "verified", coverage: local, diagnostics };
    }

    if (!Number.isInteger(year) || year < 1 || year > 9999) {
      diagnostics.push(diagnostic(
        "INVALID_HOLIDAY_YEAR",
        "error",
        "Holiday year must be a Gregorian year.",
        ["year"],
      ));
      return this.unverified(diagnostics);
    }
    if (scope !== ARGENTINE_NATIONAL_HOLIDAY_SCOPE) {
      diagnostics.push(diagnostic(
        "UNSUPPORTED_HOLIDAY_SCOPE",
        "error",
        "Only Argentine national holiday coverage is supported.",
        ["scope"],
      ));
      return this.unverified(diagnostics);
    }
    if (year > Number(today.slice(0, 4))) {
      diagnostics.push(diagnostic(
        "UNSUPPORTED_FUTURE_HOLIDAY_YEAR",
        "warning",
        "Remote holiday coverage is not requested for a future year.",
        ["year"],
      ));
      return this.unverified(diagnostics);
    }

    const provenance: HolidayProvenance = {
      source: "ArgentinaDatos",
      retrievedOn: today,
      validThrough: yearEnd(year),
    };

    let candidate: HolidayCoverageCandidate;
    try {
      candidate = await this.gateway.fetch(year, scope, provenance);
    } catch {
      diagnostics.push(diagnostic(
        "HOLIDAY_TRANSPORT_FAILED",
        "warning",
        "Holiday fallback could not be retrieved.",
      ));
      return this.unverified(diagnostics);
    }

    const validation = validateHolidayCoverage(candidate, validationDate);
    if (!validation.ok) {
      diagnostics.push(diagnostic(
        "INVALID_REMOTE_HOLIDAY_COVERAGE",
        "warning",
        "Holiday fallback returned invalid coverage.",
      ), ...validation.diagnostics);
      return this.unverified(diagnostics);
    }
    if (validation.value.holidays.length === 0) {
      diagnostics.push(diagnostic(
        "MISSING_REMOTE_HOLIDAY_YEAR",
        "warning",
        "Holiday fallback did not provide renderable coverage for the requested year.",
        ["year"],
      ));
      return this.unverified(diagnostics);
    }

    try {
      await this.store.commit(validation.value);
    } catch {
      diagnostics.push(diagnostic(
        "HOLIDAY_PERSISTENCE_FAILED",
        "warning",
        "Validated holiday coverage could not be persisted.",
      ));
      return this.unverified(diagnostics);
    }

    return { verification: "verified", coverage: validation.value, diagnostics };
  }

  private currentDate(diagnostics: Diagnostic[]): DateOnly | undefined {
    try {
      const value = dateOnly(this.clock.now());
      if (value) return value;
    } catch {
      // Resolver failures must stay diagnostic rather than escape to callers.
    }

    diagnostics.push(diagnostic(
      "INVALID_CLOCK_DATE",
      "error",
      "The resolver clock did not provide a valid date.",
    ));
    return undefined;
  }

  private async loadLocal(
    year: number,
    scope: HolidayScope,
    today: DateOnly,
    diagnostics: Diagnostic[],
  ): Promise<HolidayCoverage | undefined> {
    let stored: unknown;
    try {
      stored = await this.store.load(year, scope);
    } catch {
      diagnostics.push(diagnostic(
        "LOCAL_COVERAGE_INVALID",
        "warning",
        "Local holiday coverage could not be loaded.",
      ));
      return undefined;
    }
    if (stored === undefined) return undefined;

    const validation = validateHolidayCoverage(
      rehydrateCoverageCandidate(stored),
      today,
    );
    if (validation.ok) return validation.value;

    diagnostics.push(diagnostic(
      "LOCAL_COVERAGE_INVALID",
      "warning",
      "Local holiday coverage is invalid, incomplete, or expired.",
    ), ...validation.diagnostics);
    return undefined;
  }

  private unverified(diagnostics: readonly Diagnostic[]): HolidayResolution {
    return { verification: "unverified", diagnostics };
  }
}
