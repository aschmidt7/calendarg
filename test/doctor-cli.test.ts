import assert from "node:assert/strict";
import test from "node:test";

import { runDoctorCli, type DoctorCliDependencies } from "../src/cli/doctor.ts";
import type { DoctorFileSystem, DoctorProcess } from "../src/application/doctor.ts";

const okProcess: DoctorProcess = {
  runText: async () => "ok 1.0\n",
};

const okFileSystem: DoctorFileSystem = {
  fileExists: async () => true,
  ensureWritableDirectory: async () => true,
};

const dependencies: DoctorCliDependencies = {
  process: okProcess,
  fileSystem: okFileSystem,
  nodeVersion: "v24.16.0",
  dataRoot: "/tmp/calendarg-data",
};

test("exits 0 and prints the JSON report when every check passes", async () => {
  const result = await runDoctorCli(dependencies);

  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.ok(Array.isArray(parsed.checks));
});

test("exits 1 and still prints the JSON report when a check fails", async () => {
  const result = await runDoctorCli({
    ...dependencies,
    fileSystem: { fileExists: async () => false, ensureWritableDirectory: async () => true },
  });

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.checks.some((check: { status: string }) => check.status !== "ok"));
});

test("passes every real check on this host, including Poppler's stderr-only version banners", async () => {
  const result = await runDoctorCli();

  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  const pdfinfo = parsed.checks.find((check: { name: string }) => check.name === "pdfinfo");
  assert.match(pdfinfo.detail, /pdfinfo version/);
});
