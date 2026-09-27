import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
  type Clock,
  type Transport,
} from "../contracts.ts";
import {
  generateMonthlyCalendarPdf,
  type GenerationServiceDependencies,
  type GenerationServiceResult,
} from "../application/generate.ts";
import { JsonHolidayRepository } from "../infrastructure/holiday-repository.ts";
import {
  ArgentinaDatosHolidayGateway,
  HolidayResolver,
  type HolidayCoverageStore,
  type HolidayGateway,
} from "../application/holiday-resolver.ts";
import {
  NodePdfFileSystem,
  NodePdfInspectionSeam,
  NodePdfProcess,
} from "../infrastructure/runtime.ts";
import type {
  PdfFileSystem,
  PdfInspectionSeam,
  PdfProcess,
} from "../infrastructure/pdf.ts";

const CURL_EXECUTABLE = "/usr/bin/curl";
const DEFAULT_DATA_ROOT = fileURLToPath(new URL("../../data", import.meta.url));

interface NodeTextProcess extends PdfProcess {
  runText(executable: string, args: readonly string[]): Promise<string>;
}

interface ParsedArguments {
  readonly year: number;
  readonly month: number;
  readonly outputPath: string;
  readonly dataRoot: string;
}

export interface CliRunResult {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CliDependencies {
  readonly clock?: Clock;
  readonly createRepository?: (root: string) => HolidayCoverageStore;
  readonly createHolidayGateway?: (process: NodeTextProcess) => HolidayGateway;
  readonly createPdfProcess?: () => NodeTextProcess;
  readonly createPdfFileSystem?: () => PdfFileSystem;
  readonly createPdfInspectionSeam?: (process: NodeTextProcess) => PdfInspectionSeam;
  readonly generate?: (
    input: unknown,
    dependencies: GenerationServiceDependencies,
  ) => Promise<GenerationServiceResult>;
  readonly writeOutput?: (path: string, bytes: Uint8Array) => Promise<void>;
}

class NodePdfProcessTransport implements Transport<string, unknown> {
  readonly #process: NodeTextProcess;

  constructor(process: NodeTextProcess) {
    this.#process = process;
  }

  async send(url: string): Promise<unknown> {
    const response = await this.#process.runText(CURL_EXECUTABLE, [
      "--fail",
      "--silent",
      "--show-error",
      url,
    ]);
    return JSON.parse(response);
  }
}

const systemClock = (): Clock => {
  const instant = new Date();
  return { now: () => new Date(instant.getTime()) };
};

const defaultWriteOutput = async (path: string, bytes: Uint8Array): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
};

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const message = (error: unknown): string =>
  error instanceof Error ? error.message : "Calendar generation failed.";

const failure = (exitCode: 1 | 2, error: string): CliRunResult => ({
  exitCode,
  stdout: "",
  stderr: `${JSON.stringify({ error })}\n`,
});

const parsePositiveInteger = (flag: string, value: string | undefined): number => {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new Error(`${flag} must be an integer.`);
  }
  return Number(value);
};

const parseArguments = (argv: readonly string[]): ParsedArguments => {
  const values = new Map<string, string>();
  const supported = new Set(["--year", "--month", "--output", "--data-root"]);

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!supported.has(flag)) throw new Error(`Unsupported argument: ${flag}.`);
    if (values.has(flag)) throw new Error(`Argument may only be supplied once: ${flag}.`);
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    values.set(flag, value);
  }

  const year = parsePositiveInteger("--year", values.get("--year"));
  if (year < 1 || year > 9999) throw new Error("--year must be a Gregorian year.");

  const month = parsePositiveInteger("--month", values.get("--month"));
  if (month < 1 || month > 12) throw new Error("--month must be between 1 and 12.");

  const outputPath = values.get("--output") ?? `calendar-${year}-${String(month).padStart(2, "0")}.pdf`;
  const dataRoot = values.get("--data-root") ?? DEFAULT_DATA_ROOT;
  if (outputPath === "" || dataRoot === "") throw new Error("Output and data-root paths must not be empty.");

  return { year, month, outputPath, dataRoot };
};

const report = (
  outputPath: string,
  result: Extract<GenerationServiceResult, { readonly ok: true }>,
): string => JSON.stringify({
  outputPath,
  holidayVerification: result.holidayVerification,
  diagnostics: result.diagnostics,
  sha256: sha256(result.artifact.bytes),
  pdf: {
    mediaType: result.artifact.mediaType,
    pageCount: result.artifact.pageCount,
    byteLength: result.artifact.bytes.byteLength,
  },
});

/** Runs the local-first calendar command without writing to process streams. */
export const runCli = async (
  argv: readonly string[],
  dependencies: CliDependencies = {},
): Promise<CliRunResult> => {
  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    return failure(2, message(error));
  }

  try {
    const process = dependencies.createPdfProcess?.() ?? new NodePdfProcess();
    const repository = dependencies.createRepository?.(parsed.dataRoot) ??
      new JsonHolidayRepository(parsed.dataRoot);
    const gateway = dependencies.createHolidayGateway?.(process) ??
      new ArgentinaDatosHolidayGateway(new NodePdfProcessTransport(process));
    const holidayResolver = new HolidayResolver(
      repository,
      gateway,
      dependencies.clock ?? systemClock(),
    );
    const result = await (dependencies.generate ?? generateMonthlyCalendarPdf)(
      {
        year: parsed.year,
        month: parsed.month,
        template: "vertical-monthly-v1",
        holidayScope: ARGENTINE_NATIONAL_HOLIDAY_SCOPE,
      },
      {
        holidayResolver,
        pdf: {
          fileSystem: dependencies.createPdfFileSystem?.() ?? new NodePdfFileSystem(),
          process,
          inspector: dependencies.createPdfInspectionSeam?.(process) ??
            new NodePdfInspectionSeam(process as NodePdfProcess),
        },
      },
    );

    if (!result.ok) return failure(1, "Calendar generation rejected the request.");

    await (dependencies.writeOutput ?? defaultWriteOutput)(parsed.outputPath, result.artifact.bytes);
    return {
      exitCode: 0,
      stdout: `${report(parsed.outputPath, result)}\n`,
      stderr: "",
    };
  } catch (error) {
    return failure(1, message(error));
  }
};

const isEntrypoint = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const result = await runCli(process.argv.slice(2));
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
