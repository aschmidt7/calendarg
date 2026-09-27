import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  JsonHolidayRepository,
  type HolidayRepositoryFileSystem,
} from "../src/holiday-repository.ts";
import type { HolidayCoverage } from "../src/holidays.ts";

const coverage = (overrides: Partial<HolidayCoverage> = {}): HolidayCoverage => ({
  year: 2024,
  scope: "argentina-national",
  status: "valid",
  coveredFrom: "2024-01-01",
  coveredThrough: "2024-12-31",
  provenance: {
    source: "fixed-fixture",
    retrievedOn: "2024-01-01",
    validThrough: "2024-12-31",
  },
  holidays: [
    {
      date: "2024-03-24",
      label: "National Day of Remembrance",
      classification: "inamovible",
    },
    {
      date: "2024-06-17",
      label: "Martín Miguel de Güemes Day",
      classification: "trasladable",
    },
  ],
  ...overrides,
});

const temporaryRoot = async (t: test.TestContext): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "holiday-repository-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
};

const coveragePath = (root: string): string =>
  join(root, "holiday-coverage", "2024.json");

test("loads valid Argentine national coverage from its year-specific JSON file", async (t) => {
  const root = await temporaryRoot(t);
  const expected = coverage();
  await mkdir(join(root, "holiday-coverage"), { recursive: true });
  await writeFile(coveragePath(root), JSON.stringify(expected), "utf8");

  const repository = new JsonHolidayRepository(root);

  assert.deepEqual(
    await repository.load(2024, "argentina-national"),
    expected,
  );
});

test("rejects invalid JSON coverage instead of loading it", async (t) => {
  const root = await temporaryRoot(t);
  await mkdir(join(root, "holiday-coverage"), { recursive: true });
  await writeFile(coveragePath(root), "{}", "utf8");

  const repository = new JsonHolidayRepository(root);

  await assert.rejects(
    repository.load(2024, "argentina-national"),
    /invalid holiday coverage/i,
  );
});

test("atomically commits valid coverage with stable JSON serialization", async (t) => {
  const root = await temporaryRoot(t);
  const repository = new JsonHolidayRepository(root);
  const validCoverage = coverage();

  await repository.commit(validCoverage);
  const firstWrite = await readFile(coveragePath(root), "utf8");

  await repository.commit(validCoverage);
  const secondWrite = await readFile(coveragePath(root), "utf8");

  assert.equal(firstWrite, secondWrite);
  assert.deepEqual(JSON.parse(firstWrite), validCoverage);
});

test("rejects non-valid coverage before creating its target file", async (t) => {
  const root = await temporaryRoot(t);
  const repository = new JsonHolidayRepository(root);

  await assert.rejects(
    repository.commit(coverage({ status: "expired" })),
    /valid holiday coverage/i,
  );
  await assert.rejects(access(coveragePath(root)));
});

test("preserves existing valid coverage when a temporary write or rename fails", async (t) => {
  const root = await temporaryRoot(t);
  const existing = coverage({ provenance: { source: "old", retrievedOn: "2024-01-01", validThrough: "2024-12-31" } });
  const replacement = coverage({ provenance: { source: "new", retrievedOn: "2024-02-01", validThrough: "2024-12-31" } });
  const baseline = new JsonHolidayRepository(root);
  await baseline.commit(existing);
  const target = coveragePath(root);

  const writeFailureFileSystem: HolidayRepositoryFileSystem = {
    mkdir,
    readFile,
    rename,
    writeFile: async (path, contents) => {
      if (path !== target) throw new Error("simulated temporary write failure");
      await writeFile(path, contents, "utf8");
    },
  };
  await assert.rejects(
    new JsonHolidayRepository(root, writeFailureFileSystem).commit(replacement),
    /simulated temporary write failure/,
  );
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), existing);

  const renameFailureFileSystem: HolidayRepositoryFileSystem = {
    mkdir,
    readFile,
    writeFile,
    rename: async () => {
      throw new Error("simulated rename failure");
    },
  };
  await assert.rejects(
    new JsonHolidayRepository(root, renameFailureFileSystem).commit(replacement),
    /simulated rename failure/,
  );
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), existing);
});
