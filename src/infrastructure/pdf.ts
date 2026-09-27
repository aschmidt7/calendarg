import { validateRestrictedSvg } from "../rendering/svg.ts";

export const DEFAULT_RSVG_CONVERT_PATH = "/usr/bin/rsvg-convert";
export const DEFAULT_RENDER_TIMEOUT_MS = 20_000;

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly stderr?: string;
  readonly timedOut?: boolean;
}

/** A process boundary that passes an executable and argv directly, never a shell command. */
export interface PdfProcess {
  run(
    executable: string,
    args: readonly string[],
    options: { readonly timeoutMs: number },
  ): Promise<ProcessResult>;
}

/** Filesystem boundary limited to controlled paths allocated by the adapter. */
export interface PdfFileSystem {
  allocateTemporaryPath(suffix: ".svg" | ".pdf"): Promise<string>;
  writeFile(path: string, value: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}

/** Inspection boundary for the approved local PDF utilities. */
export interface PdfInspectionSeam {
  pdfinfo(path: string): Promise<string>;
  pdffonts(path: string): Promise<string>;
  pdftotext(path: string): Promise<string>;
}

export interface PdfRenderDependencies {
  readonly fileSystem: PdfFileSystem;
  readonly process: PdfProcess;
  readonly inspector: PdfInspectionSeam;
}

export interface PdfRenderOptions {
  readonly executable?: string;
  readonly timeoutMs?: number;
}

export interface PdfDiagnostic {
  readonly stage: "renderer" | "inspection";
  readonly code: string;
  readonly message: string;
}

export interface InspectedPdfArtifact {
  readonly mediaType: "application/pdf";
  readonly bytes: Uint8Array;
  readonly pageCount: 1;
}

export interface PdfRenderResult {
  readonly artifact: InspectedPdfArtifact;
  readonly diagnostics: readonly PdfDiagnostic[];
}

export class PdfRenderError extends Error {
  readonly diagnostics: readonly PdfDiagnostic[];

  constructor(diagnostic: PdfDiagnostic) {
    super(diagnostic.message);
    this.name = "PdfRenderError";
    this.diagnostics = [diagnostic];
  }
}

const failure = (stage: PdfDiagnostic["stage"], code: string, message: string): never => {
  throw new PdfRenderError({ stage, code, message });
};

const cleanup = async (fileSystem: PdfFileSystem, paths: readonly string[]): Promise<void> => {
  for (const path of paths) {
    try {
      await fileSystem.remove(path);
    } catch {
      // Cleanup failure must not hide a renderer or inspection failure.
    }
  }
};

const assertOneA4PortraitPage = (pdfinfo: string): void => {
  const pages = pdfinfo.match(/^Pages:\s*(\d+)\s*$/m);
  if (!pages || pages[1] !== "1") {
    failure("inspection", "invalid-page-count", "PDF inspection requires exactly one page.");
  }

  const pageSize = pdfinfo.match(/^Page size:\s*([0-9]+(?:\.[0-9]+)?)\s+x\s+([0-9]+(?:\.[0-9]+)?)\s+pts\b/m);
  if (!pageSize) {
    failure("inspection", "missing-media-box", "PDF inspection requires an A4 portrait media box.");
  }
  const width = Number(pageSize[1]);
  const height = Number(pageSize[2]);
  const a4WidthPoints = 595.276;
  const a4HeightPoints = 841.89;
  const roundingTolerancePoints = 0.5;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width >= height ||
    Math.abs(width - a4WidthPoints) > roundingTolerancePoints ||
    Math.abs(height - a4HeightPoints) > roundingTolerancePoints
  ) {
    failure("inspection", "invalid-media-box", "PDF inspection requires an A4 portrait media box.");
  }
};

const assertEmbeddedDejaVuSans = (pdffonts: string): void => {
  const embeddedDejaVu = pdffonts
    .split(/\r?\n/)
    .some((line) => /dejavu[\s-]*sans/i.test(line) && /\byes\b/i.test(line));
  if (!embeddedDejaVu) {
    failure("inspection", "missing-embedded-dejavu-sans", "PDF inspection requires embedded DejaVu Sans.");
  }
};

const assertRequiredText = (text: string, requiredTextTokens: readonly string[]): void => {
  if (requiredTextTokens.length === 0 || requiredTextTokens.some((token) => typeof token !== "string" || token === "")) {
    failure("inspection", "invalid-required-text", "PDF inspection requires non-empty required text tokens.");
  }
  for (const token of requiredTextTokens) {
    if (!text.includes(token)) {
      failure("inspection", "missing-required-text", `PDF inspection is missing required text token: ${token}.`);
    }
  }
};

const inspectPdf = async (
  path: string,
  requiredTextTokens: readonly string[],
  inspector: PdfInspectionSeam,
): Promise<void> => {
  let pdfinfo: string;
  let pdffonts: string;
  let pdftotext: string;
  try {
    [pdfinfo, pdffonts, pdftotext] = await Promise.all([
      inspector.pdfinfo(path),
      inspector.pdffonts(path),
      inspector.pdftotext(path),
    ]);
  } catch {
    failure("inspection", "inspection-command-failed", "PDF inspection command failed.");
  }
  assertOneA4PortraitPage(pdfinfo!);
  assertEmbeddedDejaVuSans(pdffonts!);
  assertRequiredText(pdftotext!, requiredTextTokens);
};

/**
 * Renders a validated restricted SVG with rsvg-convert, then accepts only a
 * freshly created PDF that passes the fixed v1 page, font, and text checks.
 */
export const renderRestrictedSvgToPdf = async (
  svg: string,
  requiredTextTokens: readonly string[],
  dependencies: PdfRenderDependencies,
  options: PdfRenderOptions = {},
): Promise<PdfRenderResult> => {
  validateRestrictedSvg(svg);

  const executable = options.executable ?? DEFAULT_RSVG_CONVERT_PATH;
  const timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  if (executable === "" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    failure("renderer", "invalid-render-options", "PDF renderer options must use a non-empty executable and positive timeout.");
  }

  const inputPath = await dependencies.fileSystem.allocateTemporaryPath(".svg");
  let outputPath: string | undefined;
  try {
    outputPath = await dependencies.fileSystem.allocateTemporaryPath(".pdf");
    if (inputPath === outputPath) {
      failure("renderer", "unsafe-temporary-paths", "PDF renderer temporary input and output paths must differ.");
    }
    if (await dependencies.fileSystem.exists(outputPath)) {
      failure("renderer", "output-not-fresh", "PDF renderer output path must be fresh.");
    }
    await dependencies.fileSystem.writeFile(inputPath, svg);

    let processResult: ProcessResult;
    try {
      processResult = await dependencies.process.run(
        executable,
        ["--format=pdf", "--output", outputPath, inputPath],
        { timeoutMs },
      );
    } catch {
      failure("renderer", "renderer-command-failed", "rsvg-convert failed to start or complete.");
    }
    if (processResult!.timedOut) {
      failure("renderer", "renderer-timeout", "rsvg-convert timed out.");
    }
    if (processResult!.exitCode !== 0) {
      failure("renderer", "renderer-exit-failure", "rsvg-convert failed.");
    }
    if (!(await dependencies.fileSystem.exists(outputPath))) {
      failure("renderer", "missing-output", "rsvg-convert did not create a fresh PDF output.");
    }

    const bytes = await dependencies.fileSystem.readFile(outputPath);
    if (bytes.byteLength === 0) {
      failure("renderer", "empty-output", "rsvg-convert did not create a fresh PDF output.");
    }
    await inspectPdf(outputPath, requiredTextTokens, dependencies.inspector);
    return {
      artifact: { mediaType: "application/pdf", bytes, pageCount: 1 },
      diagnostics: [],
    };
  } finally {
    await cleanup(dependencies.fileSystem, outputPath ? [inputPath, outputPath] : [inputPath]);
  }
};
