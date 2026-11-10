/**
 * Release-metadata diagnostics: confirms package.json, README.md, and
 * CHANGELOG.md are internally consistent with each other and that the
 * runtime environment (via `runDoctor`) is ready. This never touches the
 * real filesystem or spawns the test suite itself; every check goes
 * through the injected seams so it stays testable and fast.
 */

import { runDoctor, type DoctorDependencies } from "./doctor.ts";

export type ReleaseCheckStatus = "ok" | "missing" | "error";

export interface ReleaseCheckCheck {
  readonly name: string;
  readonly status: ReleaseCheckStatus;
  readonly detail: string;
}

export interface ReleaseCheckReport {
  readonly ok: boolean;
  readonly checks: readonly ReleaseCheckCheck[];
}

export interface ReleaseCheckFileSystem {
  fileExists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
}

export interface ReleaseCheckDependencies {
  readonly fileSystem: ReleaseCheckFileSystem;
  readonly doctor: DoctorDependencies;
  readonly packageJsonPath: string;
  readonly readmePath: string;
  readonly changelogPath: string;
}

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

interface PackageJsonCheckResult {
  readonly checks: readonly ReleaseCheckCheck[];
  readonly version?: string;
}

const errorDetail = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const checkPackageJson = async (
  path: string,
  fileSystem: ReleaseCheckFileSystem,
): Promise<PackageJsonCheckResult> => {
  const exists = await fileSystem.fileExists(path);
  if (!exists) {
    return {
      checks: [
        { name: "package.json:version", status: "missing", detail: `${path} was not found.` },
        { name: "package.json:engines", status: "missing", detail: `${path} was not found.` },
      ],
    };
  }

  let parsed: unknown;
  try {
    const text = await fileSystem.readText(path);
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = `${path} could not be read or parsed: ${errorDetail(error)}`;
    return {
      checks: [
        { name: "package.json:version", status: "error", detail },
        { name: "package.json:engines", status: "error", detail },
      ],
    };
  }

  const record = parsed as { version?: unknown; engines?: { node?: unknown } };
  const version = typeof record.version === "string" ? record.version : undefined;
  const versionCheck: ReleaseCheckCheck =
    version !== undefined && version !== "" && SEMVER_PATTERN.test(version)
      ? { name: "package.json:version", status: "ok", detail: `${path} declares version ${version}.` }
      : {
          name: "package.json:version",
          status: "missing",
          detail: `${path} does not declare a non-empty semver "version".`,
        };

  const enginesNode = record.engines?.node;
  const enginesCheck: ReleaseCheckCheck =
    typeof enginesNode === "string" && enginesNode !== ""
      ? { name: "package.json:engines", status: "ok", detail: `${path} declares engines.node ${enginesNode}.` }
      : {
          name: "package.json:engines",
          status: "missing",
          detail: `${path} does not declare an "engines.node" constraint.`,
        };

  return { checks: [versionCheck, enginesCheck], version };
};

const checkReadme = async (
  path: string,
  version: string | undefined,
  fileSystem: ReleaseCheckFileSystem,
): Promise<ReleaseCheckCheck> => {
  const exists = await fileSystem.fileExists(path);
  if (!exists) return { name: "readme", status: "missing", detail: `${path} was not found.` };
  if (version === undefined) {
    return {
      name: "readme",
      status: "error",
      detail: "No package version is available to verify against README.md.",
    };
  }
  const text = await fileSystem.readText(path);
  return text.includes(version)
    ? { name: "readme", status: "ok", detail: `${path} mentions version ${version}.` }
    : { name: "readme", status: "missing", detail: `${path} does not mention version ${version}.` };
};

const checkChangelog = async (
  path: string,
  version: string | undefined,
  fileSystem: ReleaseCheckFileSystem,
): Promise<ReleaseCheckCheck> => {
  const exists = await fileSystem.fileExists(path);
  if (!exists) return { name: "changelog", status: "missing", detail: `${path} was not found.` };
  if (version === undefined) {
    return {
      name: "changelog",
      status: "error",
      detail: "No package version is available to verify against CHANGELOG.md.",
    };
  }
  const text = await fileSystem.readText(path);
  const hasSection = text.includes(`[${version}]`) || text.includes(version);
  return hasSection
    ? { name: "changelog", status: "ok", detail: `${path} documents version ${version}.` }
    : {
        name: "changelog",
        status: "missing",
        detail: `${path} does not document a section for version ${version}.`,
      };
};

export const runReleaseCheck = async (
  dependencies: ReleaseCheckDependencies,
): Promise<ReleaseCheckReport> => {
  const packageJsonResult = await checkPackageJson(dependencies.packageJsonPath, dependencies.fileSystem);
  const readmeCheck = await checkReadme(
    dependencies.readmePath,
    packageJsonResult.version,
    dependencies.fileSystem,
  );
  const changelogCheck = await checkChangelog(
    dependencies.changelogPath,
    packageJsonResult.version,
    dependencies.fileSystem,
  );
  const doctorReport = await runDoctor(dependencies.doctor);
  const doctorChecks: ReleaseCheckCheck[] = doctorReport.checks.map((check) => ({
    name: `doctor:${check.name}`,
    status: check.status,
    detail: check.detail,
  }));

  const checks: ReleaseCheckCheck[] = [
    ...packageJsonResult.checks,
    readmeCheck,
    changelogCheck,
    ...doctorChecks,
  ];

  return { ok: checks.every((check) => check.status === "ok"), checks };
};
