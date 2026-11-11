import assert from "node:assert/strict";
import test from "node:test";

import { runReleaseCheck, type ReleaseCheckFileSystem } from "../src/application/release-check.ts";
import type { DoctorFileSystem, DoctorProcess } from "../src/application/doctor.ts";
import { runReleaseCheckCli } from "../src/cli/release-check.ts";

const PACKAGE_JSON = JSON.stringify({
  name: "calendarg",
  version: "0.1.0",
  engines: { node: ">=22.6.0" },
});

const README = "# Calendarg\n\n**Version:** `0.1.0`\n";
const CHANGELOG = "# Changelog\n\n## [0.1.0] - 2026-09-27\n\n### Added\n\n- Things.\n";

const okDoctorProcess: DoctorProcess = {
  runText: async () => "unknown 1.0\n",
};

const okDoctorFileSystem: DoctorFileSystem = {
  fileExists: async () => true,
  ensureWritableDirectory: async () => true,
};

const baseDoctor = {
  process: okDoctorProcess,
  fileSystem: okDoctorFileSystem,
  nodeVersion: "v24.16.0",
  dataRoot: "/tmp/calendarg-release-check-data",
};

const fakeFileSystem = (files: Record<string, string>): ReleaseCheckFileSystem => ({
  fileExists: async (path: string) => path in files,
  readText: async (path: string) => {
    if (!(path in files)) throw new Error(`ENOENT: ${path}`);
    return files[path];
  },
});

const baseDependencies = () => ({
  fileSystem: fakeFileSystem({
    "package.json": PACKAGE_JSON,
    "README.md": README,
    "CHANGELOG.md": CHANGELOG,
  }),
  packageJsonPath: "package.json",
  readmePath: "README.md",
  changelogPath: "CHANGELOG.md",
  doctor: baseDoctor,
});

test("reports ok for a fully satisfied release", async () => {
  const report = await runReleaseCheck(baseDependencies());

  assert.equal(report.ok, true);
  assert.ok(report.checks.length > 0);
  assert.deepEqual(
    report.checks.map((check) => check.status),
    report.checks.map(() => "ok"),
  );
  assert.ok(report.checks.some((check) => check.name === "package.json:version"));
  assert.ok(report.checks.some((check) => check.name === "package.json:engines"));
  assert.ok(report.checks.some((check) => check.name === "readme"));
  assert.ok(report.checks.some((check) => check.name === "changelog"));
  assert.ok(report.checks.some((check) => check.name === "doctor:node"));
});

test("fails when CHANGELOG.md has no section for the current version", async () => {
  const report = await runReleaseCheck({
    ...baseDependencies(),
    fileSystem: fakeFileSystem({
      "package.json": PACKAGE_JSON,
      "README.md": README,
      "CHANGELOG.md": "# Changelog\n\n## [0.0.1] - 2020-01-01\n",
    }),
  });

  assert.equal(report.ok, false);
  const changelog = report.checks.find((check) => check.name === "changelog");
  assert.equal(changelog?.status, "missing");
});

test("fails when README.md does not mention the current version", async () => {
  const report = await runReleaseCheck({
    ...baseDependencies(),
    fileSystem: fakeFileSystem({
      "package.json": PACKAGE_JSON,
      "README.md": "# Calendarg\n\nNo version mentioned here.\n",
      "CHANGELOG.md": CHANGELOG,
    }),
  });

  assert.equal(report.ok, false);
  const readme = report.checks.find((check) => check.name === "readme");
  assert.equal(readme?.status, "missing");
});

test("fails when package.json has no engines.node constraint", async () => {
  const report = await runReleaseCheck({
    ...baseDependencies(),
    fileSystem: fakeFileSystem({
      "package.json": JSON.stringify({ name: "calendarg", version: "0.1.0" }),
      "README.md": README,
      "CHANGELOG.md": CHANGELOG,
    }),
  });

  assert.equal(report.ok, false);
  const engines = report.checks.find((check) => check.name === "package.json:engines");
  assert.equal(engines?.status, "missing");
  const version = report.checks.find((check) => check.name === "package.json:version");
  assert.equal(version?.status, "ok");
});

test("fails when package.json has no non-empty semver version", async () => {
  const report = await runReleaseCheck({
    ...baseDependencies(),
    fileSystem: fakeFileSystem({
      "package.json": JSON.stringify({ name: "calendarg", version: "", engines: { node: ">=22.6.0" } }),
      "README.md": README,
      "CHANGELOG.md": CHANGELOG,
    }),
  });

  assert.equal(report.ok, false);
  const version = report.checks.find((check) => check.name === "package.json:version");
  assert.equal(version?.status, "missing");
});

test("fails when CHANGELOG.md mentions the version only in prose, not a heading section", async () => {
  const report = await runReleaseCheck({
    ...baseDependencies(),
    fileSystem: fakeFileSystem({
      "package.json": PACKAGE_JSON,
      "README.md": README,
      "CHANGELOG.md": "# Changelog\n\nSee the 0.1.0 release notes elsewhere, not documented here yet.\n",
    }),
  });

  assert.equal(report.ok, false);
  const changelog = report.checks.find((check) => check.name === "changelog");
  assert.equal(changelog?.status, "missing");
});

test("fails when package.json declares an invalid semver version (leading zero)", async () => {
  const report = await runReleaseCheck({
    ...baseDependencies(),
    fileSystem: fakeFileSystem({
      "package.json": JSON.stringify({ name: "calendarg", version: "01.2.3", engines: { node: ">=22.6.0" } }),
      "README.md": README,
      "CHANGELOG.md": CHANGELOG,
    }),
  });

  assert.equal(report.ok, false);
  const version = report.checks.find((check) => check.name === "package.json:version");
  assert.equal(version?.status, "missing");
});

test("reports an error instead of rejecting when README.md disappears after the existence check", async () => {
  const files = {
    "package.json": PACKAGE_JSON,
    "README.md": README,
    "CHANGELOG.md": CHANGELOG,
  };
  const flakyFileSystem: ReleaseCheckFileSystem = {
    fileExists: async (path: string) => path in files,
    readText: async (path: string) => {
      if (path === "README.md") throw new Error("ENOENT: README.md");
      return files[path as keyof typeof files];
    },
  };

  const report = await runReleaseCheck({ ...baseDependencies(), fileSystem: flakyFileSystem });

  assert.equal(report.ok, false);
  const readme = report.checks.find((check) => check.name === "readme");
  assert.equal(readme?.status, "error");
});

test("fails when a doctor check fails, such as a missing executable", async () => {
  const missingExecutable = new Error("spawn /usr/bin/rsvg-convert ENOENT") as Error & { code: string };
  missingExecutable.code = "ENOENT";

  const report = await runReleaseCheck({
    ...baseDependencies(),
    doctor: {
      ...baseDoctor,
      process: {
        runText: async (executable: string) => {
          if (executable === "/usr/bin/rsvg-convert") throw missingExecutable;
          return "unknown 1.0\n";
        },
      },
    },
  });

  assert.equal(report.ok, false);
  const rsvg = report.checks.find((check) => check.name === "doctor:rsvg-convert");
  assert.equal(rsvg?.status, "missing");
});

test("CLI wrapper exits 0 and prints a JSON report for a fully satisfied release", async () => {
  const result = await runReleaseCheckCli({
    fileSystem: fakeFileSystem({
      "package.json": PACKAGE_JSON,
      "README.md": README,
      "CHANGELOG.md": CHANGELOG,
    }),
    packageJsonPath: "package.json",
    readmePath: "README.md",
    changelogPath: "CHANGELOG.md",
    process: okDoctorProcess,
    doctorFileSystem: okDoctorFileSystem,
    nodeVersion: "v24.16.0",
    dataRoot: "/tmp/calendarg-release-check-cli-data",
  });

  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
});

test("CLI wrapper exits 1 when the release report is not ok", async () => {
  const result = await runReleaseCheckCli({
    fileSystem: fakeFileSystem({
      "package.json": PACKAGE_JSON,
      "README.md": README,
      "CHANGELOG.md": "# Changelog\n\n## [0.0.1] - 2020-01-01\n",
    }),
    packageJsonPath: "package.json",
    readmePath: "README.md",
    changelogPath: "CHANGELOG.md",
    process: okDoctorProcess,
    doctorFileSystem: okDoctorFileSystem,
    nodeVersion: "v24.16.0",
    dataRoot: "/tmp/calendarg-release-check-cli-data",
  });

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
});
