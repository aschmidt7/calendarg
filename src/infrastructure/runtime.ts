import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type {
  PdfFileSystem,
  PdfInspectionSeam,
  PdfProcess,
  ProcessResult,
} from "./pdf.ts";

const DEFAULT_TEMP_ROOT = join(tmpdir(), "monthly-calendar-pdf");
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;

export interface NodePdfFileSystemOptions {
  /** Absolute or relative root for adapter-owned temporary renderer files. */
  readonly tempRoot?: string;
}

/**
 * Filesystem adapter that only accepts paths it allocated below its configured
 * temporary root. The renderer can therefore never receive a repository path.
 */
export class NodePdfFileSystem implements PdfFileSystem {
  readonly #tempRoot: string;
  readonly #allocatedPaths = new Set<string>();

  constructor({ tempRoot = DEFAULT_TEMP_ROOT }: NodePdfFileSystemOptions = {}) {
    this.#tempRoot = resolve(tempRoot);
  }

  async allocateTemporaryPath(suffix: ".svg" | ".pdf"): Promise<string> {
    if (suffix !== ".svg" && suffix !== ".pdf") {
      throw new Error("Temporary PDF paths must use .svg or .pdf suffixes.");
    }
    await mkdir(this.#tempRoot, { recursive: true, mode: 0o700 });
    const path = join(this.#tempRoot, `${randomUUID()}${suffix}`);
    this.#allocatedPaths.add(path);
    return path;
  }

  async writeFile(path: string, value: string | Uint8Array): Promise<void> {
    this.assertControlled(path);
    await writeFile(path, value);
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.assertControlled(path);
    return readFile(path);
  }

  async exists(path: string): Promise<boolean> {
    this.assertControlled(path);
    try {
      await readFile(path);
      return true;
    } catch (error: unknown) {
      if (isMissingFile(error)) return false;
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    this.assertControlled(path);
    await rm(path, { force: true });
    this.#allocatedPaths.delete(path);
  }

  private assertControlled(path: string): void {
    if (!this.#allocatedPaths.has(path)) {
      throw new Error("PDF filesystem path was not allocated by this adapter.");
    }
  }
}

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

interface CapturedProcessResult extends ProcessResult {
  readonly stdout: string;
}

/** Node child-process adapter using executable and argv values without a shell. */
export class NodePdfProcess implements PdfProcess {
  async run(
    executable: string,
    args: readonly string[],
    options: { readonly timeoutMs: number },
  ): Promise<ProcessResult> {
    const result = await this.capture(executable, args, options.timeoutMs);
    return {
      exitCode: result.exitCode,
      ...(result.stderr === "" ? {} : { stderr: result.stderr }),
      ...(result.timedOut ? { timedOut: true } : {}),
    };
  }

  async runText(
    executable: string,
    args: readonly string[],
    timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  ): Promise<string> {
    const result = await this.capture(executable, args, timeoutMs);
    if (result.timedOut) {
      throw new Error(`${executable} timed out.`);
    }
    if (result.exitCode !== 0) {
      throw new Error(`${executable} exited with code ${result.exitCode ?? "signal"}: ${result.stderr}`);
    }
    return result.stdout;
  }

  private capture(
    executable: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<CapturedProcessResult> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new Error("Process timeout must be a positive integer."));
    }

    return new Promise((resolveCapture, rejectCapture) => {
      let child;
      try {
        child = spawn(executable, [...args], {
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        rejectCapture(error);
        return;
      }

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        rejectCapture(error);
      });
      child.once("close", (exitCode) => {
        clearTimeout(timer);
        resolveCapture({ exitCode, stdout, stderr, ...(timedOut ? { timedOut: true } : {}) });
      });
    });
  }
}

/** Poppler inspection adapter executed through the same argv-only process boundary. */
export class NodePdfInspectionSeam implements PdfInspectionSeam {
  readonly #process: NodePdfProcess;

  constructor(process: NodePdfProcess = new NodePdfProcess()) {
    this.#process = process;
  }

  pdfinfo(path: string): Promise<string> {
    return this.#process.runText("/usr/bin/pdfinfo", [path]);
  }

  pdffonts(path: string): Promise<string> {
    return this.#process.runText("/usr/bin/pdffonts", [path]);
  }

  pdftotext(path: string): Promise<string> {
    return this.#process.runText("/usr/bin/pdftotext", [path, "-"]);
  }
}
