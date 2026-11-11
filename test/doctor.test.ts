import assert from "node:assert/strict";
import test from "node:test";

import { runDoctor, type DoctorFileSystem, type DoctorProcess } from "../src/application/doctor.ts";

const okProcess = (versions: Record<string, string>): DoctorProcess => ({
  runText: async (executable: string) => versions[executable] ?? "unknown 1.0\n",
});

const okFileSystem: DoctorFileSystem = {
  fileExists: async () => true,
  ensureWritableDirectory: async () => true,
};

const baseDependencies = {
  process: okProcess({
    "/usr/bin/rsvg-convert": "rsvg-convert version 2.58.0\n",
    "/usr/bin/pdfinfo": "pdfinfo version 24.02.0\n",
    "/usr/bin/pdffonts": "pdffonts version 24.02.0\n",
    "/usr/bin/pdftotext": "pdftotext version 24.02.0\n",
    "/usr/bin/curl": "curl 8.5.0 (x86_64-pc-linux-gnu)\n",
  }),
  fileSystem: okFileSystem,
  nodeVersion: "v24.16.0",
  dataRoot: "/tmp/calendarg-data",
};

test("reports ok for a fully satisfied environment", async () => {
  const report = await runDoctor(baseDependencies);

  assert.equal(report.ok, true);
  assert.deepEqual(
    report.checks.map((check) => check.status),
    report.checks.map(() => "ok"),
  );
  assert.ok(report.checks.some((check) => check.name === "node"));
  assert.ok(report.checks.some((check) => check.name === "rsvg-convert"));
  assert.ok(report.checks.some((check) => check.name === "font:dejavu-sans"));
  assert.ok(report.checks.some((check) => check.name === "data-root"));
});

test("rejects a Node version below the declared minimum", async () => {
  const report = await runDoctor({ ...baseDependencies, nodeVersion: "v20.11.0" });

  assert.equal(report.ok, false);
  const node = report.checks.find((check) => check.name === "node");
  assert.equal(node?.status, "missing");
  assert.match(node?.detail ?? "", /22\.6\.0/);
});

test("reports an error for an unparsable Node version string", async () => {
  const report = await runDoctor({ ...baseDependencies, nodeVersion: "not-a-version" });

  assert.equal(report.ok, false);
  const node = report.checks.find((check) => check.name === "node");
  assert.equal(node?.status, "error");
});

test("reports missing for a native executable that does not exist", async () => {
  const missingExecutable = new Error("spawn /usr/bin/rsvg-convert ENOENT") as Error & { code: string };
  missingExecutable.code = "ENOENT";
  const process: DoctorProcess = {
    runText: async (executable: string) => {
      if (executable === "/usr/bin/rsvg-convert") throw missingExecutable;
      return "unknown 1.0\n";
    },
  };

  const report = await runDoctor({ ...baseDependencies, process });

  assert.equal(report.ok, false);
  const rsvg = report.checks.find((check) => check.name === "rsvg-convert");
  assert.equal(rsvg?.status, "missing");
});

test("reports an error for an executable that fails for a reason other than missing", async () => {
  const process: DoctorProcess = {
    runText: async (executable: string) => {
      if (executable === "/usr/bin/curl") throw new Error("curl exited with code 7");
      return "unknown 1.0\n";
    },
  };

  const report = await runDoctor({ ...baseDependencies, process });

  assert.equal(report.ok, false);
  const curl = report.checks.find((check) => check.name === "curl");
  assert.equal(curl?.status, "error");
});

test("reports missing DejaVu Sans when the font file is absent", async () => {
  const fileSystem: DoctorFileSystem = {
    fileExists: async (path: string) => !path.includes("DejaVuSans"),
    ensureWritableDirectory: async () => true,
  };

  const report = await runDoctor({ ...baseDependencies, fileSystem });

  assert.equal(report.ok, false);
  const font = report.checks.find((check) => check.name === "font:dejavu-sans");
  assert.equal(font?.status, "missing");
});

test("reports an error when the data root is not writable", async () => {
  const fileSystem: DoctorFileSystem = {
    fileExists: async () => true,
    ensureWritableDirectory: async () => false,
  };

  const report = await runDoctor({ ...baseDependencies, fileSystem });

  assert.equal(report.ok, false);
  const dataRoot = report.checks.find((check) => check.name === "data-root");
  assert.equal(dataRoot?.status, "error");
});
