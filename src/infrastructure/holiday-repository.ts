import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  validateHolidayCoverage,
  type HolidayCoverage,
} from "../domain/holidays.ts";
import type { HolidayScope } from "../contracts.ts";

export interface HolidayRepositoryFileSystem {
  readonly mkdir: (path: string, options: { readonly recursive: true }) => Promise<unknown>;
  readonly readFile: (path: string, encoding: "utf8") => Promise<string>;
  readonly writeFile: (path: string, contents: string, encoding: "utf8") => Promise<unknown>;
  readonly rename: (from: string, to: string) => Promise<unknown>;
}

const nodeFileSystem: HolidayRepositoryFileSystem = {
  mkdir,
  readFile,
  writeFile,
  rename,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .flatMap((key) => {
        const entry = value[key];
        return entry === undefined
          ? []
          : [`${JSON.stringify(key)}:${stableJson(entry)}`];
      })
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const rehydrateCoverageCandidate = (coverage: unknown): unknown => {
  if (!isRecord(coverage) || !Array.isArray(coverage.holidays)) return coverage;

  return {
    ...coverage,
    holidays: coverage.holidays.map((holiday) =>
      isRecord(holiday)
        ? { ...holiday, scope: "argentina-national" }
        : holiday,
    ),
  };
};

const asOfDate = (coverage: unknown): string => {
  if (!isRecord(coverage) || !isRecord(coverage.provenance)) return "";
  const { validThrough } = coverage.provenance;
  return typeof validThrough === "string" ? validThrough : "";
};

const validateStoredCoverage = (coverage: unknown): HolidayCoverage => {
  const validation = validateHolidayCoverage(
    rehydrateCoverageCandidate(coverage),
    asOfDate(coverage),
  );
  if (!validation.ok) {
    throw new Error("Invalid holiday coverage.");
  }
  return validation.value;
};

const assertYear = (year: number): void => {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError("Holiday coverage year must be a Gregorian year.");
  }
};

const assertNationalScope = (scope: HolidayScope): void => {
  if (scope !== "argentina-national") {
    throw new RangeError("Only Argentine national holiday coverage is supported.");
  }
};

const isMissingFile = (error: unknown): boolean =>
  isRecord(error) && error.code === "ENOENT";

export class JsonHolidayRepository {
  readonly #coverageDirectory: string;
  private readonly fileSystem: HolidayRepositoryFileSystem;

  constructor(
    root: string,
    fileSystem: HolidayRepositoryFileSystem = nodeFileSystem,
  ) {
    this.#coverageDirectory = join(root, "holiday-coverage");
    this.fileSystem = fileSystem;
  }

  async load(year: number, scope: HolidayScope): Promise<HolidayCoverage | undefined> {
    assertYear(year);
    assertNationalScope(scope);

    let contents: string;
    try {
      contents = await this.fileSystem.readFile(this.pathFor(year), "utf8");
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      throw new Error("Invalid holiday coverage.");
    }

    const coverage = validateStoredCoverage(parsed);
    if (coverage.year !== year || coverage.scope !== scope) {
      throw new Error("Invalid holiday coverage.");
    }
    return coverage;
  }

  async commit(coverage: HolidayCoverage): Promise<void> {
    assertYear(coverage.year);
    assertNationalScope(coverage.scope);
    if (coverage.status !== "valid") {
      throw new Error("Invalid holiday coverage.");
    }

    const validatedCoverage = validateStoredCoverage(coverage);
    const target = this.pathFor(validatedCoverage.year);
    const temporary = join(
      this.#coverageDirectory,
      `.${validatedCoverage.year}.json.${randomUUID()}.tmp`,
    );

    await this.fileSystem.mkdir(this.#coverageDirectory, { recursive: true });
    await this.fileSystem.writeFile(temporary, stableJson(validatedCoverage), "utf8");
    await this.fileSystem.rename(temporary, target);
  }

  private pathFor(year: number): string {
    return join(this.#coverageDirectory, `${year}.json`);
  }
}
