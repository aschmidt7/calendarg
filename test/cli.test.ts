import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  runCli,
  type CliDependencies,
} from "../src/cli/cli.ts";

const fixedClock = { now: () => new Date("2024-06-01T00:00:00.000Z") };

const completedGeneration = async (
  input: unknown,
  dependencies: Parameters<NonNullable<CliDependencies["generate"]>>[1],
) => {
  const request = input as { year: number; month: number };
  const resolution = await dependencies.holidayResolver.resolve(
    request.year,
    "argentina-national",
  );

  return {
    ok: true as const,
    artifact: {
      mediaType: "application/pdf" as const,
      bytes: new Uint8Array([1, 2, 3, 4]),
      pageCount: 1,
    },
    holidayVerification: resolution.verification,
    diagnostics: resolution.diagnostics,
  } as Awaited<ReturnType<NonNullable<CliDependencies["generate"]>>>;
};

const localCoverage = {
  year: 2024,
  scope: "argentina-national" as const,
  status: "valid" as const,
  coveredFrom: "2024-01-01",
  coveredThrough: "2024-12-31",
  provenance: {
    source: "fixture",
    retrievedOn: "2024-01-01",
    validThrough: "2024-12-31",
  },
  holidays: [],
};

test("--help prints usage text listing every supported flag and exits 0", async () => {
  const result = await runCli(["--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /usage/i);
  for (const flag of ["--year", "--month", "--output", "--data-root", "--force", "--help", "--version"]) {
    assert.match(result.stdout, new RegExp(flag.replace("-", "\\-"), "i"));
  }
});

test("-h is an alias for --help", async () => {
  const result = await runCli(["-h"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /usage/i);
});

test("--version prints the package.json version and exits 0", async () => {
  const packageJsonText = await readFile(
    new URL("../package.json", import.meta.url),
    "utf8",
  );
  const expectedVersion = JSON.parse(packageJsonText).version as string;

  const result = await runCli(["--version"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `${expectedVersion}\n`);
});

test("--help takes precedence over --version when both are given", async () => {
  const result = await runCli(["--help", "--version"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /usage/i);
});

test("requires explicit valid year and month arguments", async () => {
  for (const argv of [
    ["--month", "6"],
    ["--year", "2024"],
    ["--year", "2024", "--month", "13"],
    ["--year", "2024.5", "--month", "6"],
    ["--year", "9999", "--month", "12"],
    ["--year", "1", "--month", "1"],
  ]) {
    const result = await runCli(argv);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--year|--month/i);
  }
});

test("uses valid local coverage without invoking the holiday gateway", async () => {
  let gatewayCalls = 0;
  const writes: Array<{ path: string; bytes: Uint8Array }> = [];
  const dataRoots: string[] = [];
  const dependencies: CliDependencies = {
    clock: fixedClock,
    createRepository: (root) => {
      dataRoots.push(root);
      return {
        load: async () => localCoverage,
        commit: async () => assert.fail("local coverage must not be replaced"),
      };
    },
    createHolidayGateway: () => ({
      fetch: async () => {
        gatewayCalls += 1;
        throw new Error("network must not be called");
      },
    }),
    generate: completedGeneration,
    writeOutput: async (path, bytes) => {
      writes.push({ path, bytes });
    },
  };

  const result = await runCli([
    "--year", "2024", "--month", "6", "--data-root", "fixtures/data", "--output", "out/june.pdf",
  ], dependencies);

  assert.equal(result.exitCode, 0);
  assert.equal(gatewayCalls, 0);
  assert.deepEqual(dataRoots, ["fixtures/data"]);
  assert.deepEqual(writes, [{ path: "out/june.pdf", bytes: new Uint8Array([1, 2, 3, 4]) }]);
  assert.deepEqual(JSON.parse(result.stdout), {
    outputPath: "out/june.pdf",
    holidayVerification: "verified",
    diagnostics: [],
    sha256: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
    pdf: {
      mediaType: "application/pdf",
      pageCount: 1,
      byteLength: 4,
    },
  });
});

test("keeps an offline holiday fallback successful and explicitly unverified", async () => {
  const outputPaths: string[] = [];
  const dependencies: CliDependencies = {
    clock: fixedClock,
    createRepository: () => ({
      load: async () => undefined,
      commit: async () => assert.fail("offline coverage must not be committed"),
    }),
    createHolidayGateway: () => ({
      fetch: async () => {
        throw new Error("offline");
      },
    }),
    generate: completedGeneration,
    writeOutput: async (path) => {
      outputPaths.push(path);
    },
  };

  const result = await runCli(["--year", "2024", "--month", "6"], dependencies);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(outputPaths, ["calendar-2024-06.pdf"]);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.holidayVerification, "unverified");
  assert.deepEqual(payload.diagnostics.map((diagnostic: { code: string }) => diagnostic.code), [
    "HOLIDAY_TRANSPORT_FAILED",
  ]);
});

test("returns a nonzero result when rendering fails", async () => {
  const result = await runCli(["--year", "2024", "--month", "6"], {
    generate: async () => {
      throw new Error("renderer unavailable");
    },
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /renderer unavailable/i);
});

test("refuses to overwrite an existing output path without --force", async () => {
  let writeCalls = 0;
  const dependencies: CliDependencies = {
    clock: fixedClock,
    createRepository: () => ({
      load: async () => localCoverage,
      commit: async () => assert.fail("local coverage must not be replaced"),
    }),
    createHolidayGateway: () => ({
      fetch: async () => assert.fail("gateway must not be called"),
    }),
    generate: completedGeneration,
    outputExists: async () => true,
    writeOutput: async () => {
      writeCalls += 1;
    },
  };

  const result = await runCli(
    ["--year", "2024", "--month", "6", "--output", "out/june.pdf"],
    dependencies,
  );

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /out\/june\.pdf.*--force/i);
  assert.equal(writeCalls, 0);
});

test("overwrites an existing output path when --force is given", async () => {
  const writes: string[] = [];
  const dependencies: CliDependencies = {
    clock: fixedClock,
    createRepository: () => ({
      load: async () => localCoverage,
      commit: async () => assert.fail("local coverage must not be replaced"),
    }),
    createHolidayGateway: () => ({
      fetch: async () => assert.fail("gateway must not be called"),
    }),
    generate: completedGeneration,
    outputExists: async () => true,
    writeOutput: async (path) => {
      writes.push(path);
    },
  };

  const result = await runCli(
    ["--year", "2024", "--month", "6", "--output", "out/june.pdf", "--force"],
    dependencies,
  );

  assert.equal(result.exitCode, 0);
  assert.deepEqual(writes, ["out/june.pdf"]);
});

test("proceeds without a check when the output path does not exist", async () => {
  const dependencies: CliDependencies = {
    clock: fixedClock,
    createRepository: () => ({
      load: async () => localCoverage,
      commit: async () => assert.fail("local coverage must not be replaced"),
    }),
    createHolidayGateway: () => ({
      fetch: async () => assert.fail("gateway must not be called"),
    }),
    generate: completedGeneration,
    outputExists: async () => false,
    writeOutput: async () => {},
  };

  const result = await runCli(
    ["--year", "2024", "--month", "6", "--output", "out/june.pdf"],
    dependencies,
  );

  assert.equal(result.exitCode, 0);
});

test("writes real output atomically, refuses an existing file, and replaces it with --force", async () => {
  const directory = await mkdtemp(join(tmpdir(), "calendarg-cli-output-"));
  try {
    const outputPath = join(directory, "calendar.pdf");
    await writeFile(outputPath, new Uint8Array([9, 9, 9]));

    const dependencies: CliDependencies = {
      clock: fixedClock,
      createRepository: () => ({
        load: async () => localCoverage,
        commit: async () => assert.fail("local coverage must not be replaced"),
      }),
      createHolidayGateway: () => ({
        fetch: async () => assert.fail("gateway must not be called"),
      }),
      generate: completedGeneration,
    };

    const refused = await runCli(
      ["--year", "2024", "--month", "6", "--output", outputPath],
      dependencies,
    );
    assert.equal(refused.exitCode, 1);
    assert.match(refused.stderr, /--force/);
    assert.deepEqual([...await readFile(outputPath)], [9, 9, 9]);

    const forced = await runCli(
      ["--year", "2024", "--month", "6", "--output", outputPath, "--force"],
      dependencies,
    );
    assert.equal(forced.exitCode, 0);
    assert.deepEqual([...await readFile(outputPath)], [1, 2, 3, 4]);

    const entries = await readdir(directory);
    assert.deepEqual(entries, ["calendar.pdf"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refuses atomically when the output appears after the existence check (no --force TOCTOU)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "calendarg-cli-toctou-"));
  try {
    const outputPath = join(directory, "calendar.pdf");

    const dependencies: CliDependencies = {
      clock: fixedClock,
      createRepository: () => ({
        load: async () => localCoverage,
        commit: async () => assert.fail("local coverage must not be replaced"),
      }),
      createHolidayGateway: () => ({
        fetch: async () => assert.fail("gateway must not be called"),
      }),
      generate: completedGeneration,
      // Simulate the race: the existence check sees no file, but another
      // writer creates it before the atomic write runs.
      outputExists: async () => {
        await writeFile(outputPath, new Uint8Array([9, 9, 9]));
        return false;
      },
    };

    const result = await runCli(
      ["--year", "2024", "--month", "6", "--output", outputPath],
      dependencies,
    );

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /--force/);
    assert.deepEqual([...await readFile(outputPath)], [9, 9, 9]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
