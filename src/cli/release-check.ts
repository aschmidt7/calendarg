import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  runReleaseCheck,
  type ReleaseCheckFileSystem,
  type ReleaseCheckReport,
} from "../application/release-check.ts";
import type { DoctorFileSystem, DoctorProcess } from "../application/doctor.ts";
import { NodeDoctorFileSystem, NodeDoctorProcess } from "../infrastructure/runtime.ts";

const DEFAULT_DATA_ROOT = fileURLToPath(new URL("../../data", import.meta.url));
const DEFAULT_PACKAGE_JSON_PATH = fileURLToPath(new URL("../../package.json", import.meta.url));
const DEFAULT_README_PATH = fileURLToPath(new URL("../../README.md", import.meta.url));
const DEFAULT_CHANGELOG_PATH = fileURLToPath(new URL("../../CHANGELOG.md", import.meta.url));

/** Reuses the doctor filesystem seam for existence checks, adding plain-text reads. */
class NodeReleaseCheckFileSystem implements ReleaseCheckFileSystem {
  readonly #doctorFileSystem = new NodeDoctorFileSystem();

  fileExists(path: string): Promise<boolean> {
    return this.#doctorFileSystem.fileExists(path);
  }

  readText(path: string): Promise<string> {
    return readFile(path, "utf8");
  }
}

export interface ReleaseCheckCliDependencies {
  readonly fileSystem?: ReleaseCheckFileSystem;
  readonly process?: DoctorProcess;
  readonly doctorFileSystem?: DoctorFileSystem;
  readonly nodeVersion?: string;
  readonly dataRoot?: string;
  readonly fontPath?: string;
  readonly packageJsonPath?: string;
  readonly readmePath?: string;
  readonly changelogPath?: string;
}

export interface ReleaseCheckCliResult {
  readonly exitCode: 0 | 1;
  readonly stdout: string;
}

const report = (result: ReleaseCheckReport): string => `${JSON.stringify(result, null, 2)}\n`;

/** Runs the release-metadata diagnostics without writing to process streams. */
export const runReleaseCheckCli = async (
  dependencies: ReleaseCheckCliDependencies = {},
): Promise<ReleaseCheckCliResult> => {
  const result = await runReleaseCheck({
    fileSystem: dependencies.fileSystem ?? new NodeReleaseCheckFileSystem(),
    packageJsonPath: dependencies.packageJsonPath ?? DEFAULT_PACKAGE_JSON_PATH,
    readmePath: dependencies.readmePath ?? DEFAULT_README_PATH,
    changelogPath: dependencies.changelogPath ?? DEFAULT_CHANGELOG_PATH,
    doctor: {
      process: dependencies.process ?? new NodeDoctorProcess(),
      fileSystem: dependencies.doctorFileSystem ?? new NodeDoctorFileSystem(),
      nodeVersion: dependencies.nodeVersion ?? process.version,
      dataRoot: dependencies.dataRoot ?? DEFAULT_DATA_ROOT,
      fontPath: dependencies.fontPath,
    },
  });

  return { exitCode: result.ok ? 0 : 1, stdout: report(result) };
};

const isEntrypoint = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const result = await runReleaseCheckCli();
  process.stdout.write(result.stdout);
  process.exitCode = result.exitCode;
}
