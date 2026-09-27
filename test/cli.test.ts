import assert from "node:assert/strict";
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

test("requires explicit valid year and month arguments", async () => {
  for (const argv of [
    ["--month", "6"],
    ["--year", "2024"],
    ["--year", "2024", "--month", "13"],
    ["--year", "2024.5", "--month", "6"],
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
