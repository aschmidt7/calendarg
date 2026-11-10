/**
 * Runtime environment diagnostics for Calendarg's documented Linux-only
 * native prerequisites (rsvg-convert, Poppler, curl, DejaVu Sans) and the
 * declared minimum Node.js version. This never shells out itself: every
 * check goes through the injected process/filesystem seams so it stays
 * testable and consistent with the rest of the application layer.
 */

export interface DoctorProcess {
  runText(executable: string, args: readonly string[]): Promise<string>;
}

export interface DoctorFileSystem {
  fileExists(path: string): Promise<boolean>;
  ensureWritableDirectory(path: string): Promise<boolean>;
}

export type DoctorCheckStatus = "ok" | "missing" | "error";

export interface DoctorCheck {
  readonly name: string;
  readonly status: DoctorCheckStatus;
  readonly detail: string;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly checks: readonly DoctorCheck[];
}

export interface DoctorDependencies {
  readonly process: DoctorProcess;
  readonly fileSystem: DoctorFileSystem;
  /** Typically `process.version` (e.g. `"v24.16.0"`). */
  readonly nodeVersion: string;
  readonly dataRoot: string;
  readonly fontPath?: string;
}

interface SemanticVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Declared minimum: the first version where `--experimental-strip-types` is available. */
export const MINIMUM_NODE_VERSION: SemanticVersion = Object.freeze({ major: 22, minor: 6, patch: 0 });

/** Calendarg currently documents and checks a Linux-only native toolchain. */
export const DEFAULT_DEJAVU_SANS_FONT_PATH =
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

const formatVersion = (version: SemanticVersion): string =>
  `${version.major}.${version.minor}.${version.patch}`;

const parseVersion = (raw: string): SemanticVersion | undefined => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
};

const compareVersions = (left: SemanticVersion, right: SemanticVersion): number =>
  left.major !== right.major
    ? left.major - right.major
    : left.minor !== right.minor
      ? left.minor - right.minor
      : left.patch - right.patch;

const checkNodeVersion = (rawVersion: string): DoctorCheck => {
  const parsed = parseVersion(rawVersion);
  if (!parsed) {
    return {
      name: "node",
      status: "error",
      detail: `Could not parse a Node.js version from "${rawVersion}".`,
    };
  }
  if (compareVersions(parsed, MINIMUM_NODE_VERSION) < 0) {
    return {
      name: "node",
      status: "missing",
      detail: `Node.js ${formatVersion(parsed)} is below the required minimum ${formatVersion(MINIMUM_NODE_VERSION)}.`,
    };
  }
  return { name: "node", status: "ok", detail: `Node.js ${formatVersion(parsed)}.` };
};

interface RequiredExecutable {
  readonly name: string;
  readonly path: string;
  readonly versionArgs: readonly string[];
}

/** The documented Linux-only native prerequisites, by their fixed absolute path. */
const REQUIRED_EXECUTABLES: readonly RequiredExecutable[] = [
  { name: "rsvg-convert", path: "/usr/bin/rsvg-convert", versionArgs: ["--version"] },
  { name: "pdfinfo", path: "/usr/bin/pdfinfo", versionArgs: ["-v"] },
  { name: "pdffonts", path: "/usr/bin/pdffonts", versionArgs: ["-v"] },
  { name: "pdftotext", path: "/usr/bin/pdftotext", versionArgs: ["-v"] },
  { name: "curl", path: "/usr/bin/curl", versionArgs: ["--version"] },
];

const isMissingExecutableError = (error: unknown): boolean =>
  typeof error === "object" && error !== null &&
  (error as { code?: unknown }).code === "ENOENT";

const checkExecutable = async (
  executable: RequiredExecutable,
  process: DoctorProcess,
): Promise<DoctorCheck> => {
  try {
    const stdout = await process.runText(executable.path, executable.versionArgs);
    const firstLine = stdout.split(/\r?\n/).find((line) => line.trim() !== "")?.trim();
    return {
      name: executable.name,
      status: "ok",
      detail: firstLine && firstLine !== "" ? firstLine : `${executable.path} responded.`,
    };
  } catch (error) {
    if (isMissingExecutableError(error)) {
      return { name: executable.name, status: "missing", detail: `${executable.path} was not found.` };
    }
    return {
      name: executable.name,
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
};

const checkFont = async (
  fontPath: string,
  fileSystem: DoctorFileSystem,
): Promise<DoctorCheck> => {
  const exists = await fileSystem.fileExists(fontPath);
  return exists
    ? { name: "font:dejavu-sans", status: "ok", detail: `Found ${fontPath}.` }
    : { name: "font:dejavu-sans", status: "missing", detail: `DejaVu Sans font was not found at ${fontPath}.` };
};

const checkDataRoot = async (
  dataRoot: string,
  fileSystem: DoctorFileSystem,
): Promise<DoctorCheck> => {
  const writable = await fileSystem.ensureWritableDirectory(dataRoot);
  return writable
    ? { name: "data-root", status: "ok", detail: `${dataRoot} is writable.` }
    : { name: "data-root", status: "error", detail: `${dataRoot} is not writable.` };
};

export const runDoctor = async (dependencies: DoctorDependencies): Promise<DoctorReport> => {
  const fontPath = dependencies.fontPath ?? DEFAULT_DEJAVU_SANS_FONT_PATH;
  const checks: DoctorCheck[] = [
    checkNodeVersion(dependencies.nodeVersion),
    ...(await Promise.all(
      REQUIRED_EXECUTABLES.map((executable) => checkExecutable(executable, dependencies.process)),
    )),
    await checkFont(fontPath, dependencies.fileSystem),
    await checkDataRoot(dependencies.dataRoot, dependencies.fileSystem),
  ];
  return { ok: checks.every((check) => check.status === "ok"), checks };
};
