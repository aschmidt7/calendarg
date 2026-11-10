import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  runDoctor,
  type DoctorFileSystem,
  type DoctorProcess,
  type DoctorReport,
} from "../application/doctor.ts";
import { NodeDoctorFileSystem, NodeDoctorProcess } from "../infrastructure/runtime.ts";

const DEFAULT_DATA_ROOT = fileURLToPath(new URL("../../data", import.meta.url));

export interface DoctorCliDependencies {
  readonly process?: DoctorProcess;
  readonly fileSystem?: DoctorFileSystem;
  readonly nodeVersion?: string;
  readonly dataRoot?: string;
}

export interface DoctorCliResult {
  readonly exitCode: 0 | 1;
  readonly stdout: string;
}

const report = (result: DoctorReport): string => `${JSON.stringify(result, null, 2)}\n`;

/** Runs the environment diagnostics without writing to process streams. */
export const runDoctorCli = async (
  dependencies: DoctorCliDependencies = {},
): Promise<DoctorCliResult> => {
  const result = await runDoctor({
    process: dependencies.process ?? new NodeDoctorProcess(),
    fileSystem: dependencies.fileSystem ?? new NodeDoctorFileSystem(),
    nodeVersion: dependencies.nodeVersion ?? process.version,
    dataRoot: dependencies.dataRoot ?? DEFAULT_DATA_ROOT,
  });

  return { exitCode: result.ok ? 0 : 1, stdout: report(result) };
};

const isEntrypoint = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const result = await runDoctorCli();
  process.stdout.write(result.stdout);
  process.exitCode = result.exitCode;
}
