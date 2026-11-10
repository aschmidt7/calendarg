import { validateRestrictedSvg } from "../rendering/svg.ts";
import type {
  InspectedPdfArtifact,
  PdfDiagnostic,
  PdfRenderer,
  PdfRenderOptions,
  PdfRenderResult,
} from "../application/pdf-renderer.ts";

/** Re-exported so existing importers that reach them via this module keep compiling. */
export type {
  InspectedPdfArtifact,
  PdfDiagnostic,
  PdfRenderOptions,
  PdfRenderResult,
} from "../application/pdf-renderer.ts";

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

export class PdfRenderError extends Error {
  readonly diagnostics: readonly PdfDiagnostic[];

  constructor(diagnostic: PdfDiagnostic) {
    super(diagnostic.message);
    this.name = "PdfRenderError";
    this.diagnostics = [diagnostic];
  }
}

const failure: (stage: PdfDiagnostic["stage"], code: string, message: string) => never = (
  stage,
  code,
  message,
) => {
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

const HEADER_NAME_TOKEN = /^name$/i;
const SEPARATOR_LINE = /^-+(\s+-+)*$/;

interface PdfFontColumnSpan {
  readonly label: string;
  readonly start: number;
  readonly end: number;
}

/**
 * `pdffonts` prints fixed-width columns whose set varies by PDF (an
 * `encoding` column may or may not appear between `type` and `emb`), so the
 * embedded column index cannot be assumed. Deriving spans from the dashed
 * separator line and the header above it locates `emb` by its label instead
 * of a fixed position, and rejects an unrelated `sub`/`uni` column of `yes`
 * masking `emb no`.
 */
const pdfFontColumnSpans = (
  headerLine: string,
  separatorLine: string,
): readonly PdfFontColumnSpan[] => {
  const spans: PdfFontColumnSpan[] = [];
  const dashGroup = /-+/g;
  let match: RegExpExecArray | null;
  while ((match = dashGroup.exec(separatorLine)) !== null) {
    spans.push({
      label: headerLine.slice(match.index, match.index + match[0].length).trim().toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return spans;
};

const sliceByColumnSpans = (
  line: string,
  spans: readonly PdfFontColumnSpan[],
): Record<string, string> => {
  const values: Record<string, string> = {};
  spans.forEach((span, index) => {
    const isLastSpan = index === spans.length - 1;
    values[span.label] = (isLastSpan ? line.slice(span.start) : line.slice(span.start, span.end)).trim();
  });
  return values;
};

const columnIndex = (headerTokens: readonly string[], label: string): number =>
  headerTokens.findIndex((token) => token.toLowerCase() === label);

/** Each row exposes at least `name` and `emb`, keyed by their header label. */
const pdfFontRows = (pdffonts: string): ReadonlyArray<Record<string, string>> => {
  const lines = pdffonts.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];

  const firstToken = lines[0].trim().split(/\s+/)[0] ?? "";
  if (!HEADER_NAME_TOKEN.test(firstToken)) {
    return lines.map((line) => {
      const tokens = line.trim().split(/\s+/);
      return { name: tokens[0] ?? "", emb: tokens[2] ?? "" };
    });
  }

  const headerLine = lines[0];
  const dataLines = lines.slice(1);
  if (dataLines.length > 0 && SEPARATOR_LINE.test(dataLines[0].trim())) {
    const spans = pdfFontColumnSpans(headerLine, dataLines[0]);
    return dataLines.slice(1).map((line) => sliceByColumnSpans(line, spans));
  }

  const headerTokens = headerLine.trim().split(/\s+/);
  const nameIndex = columnIndex(headerTokens, "name");
  const embIndex = columnIndex(headerTokens, "emb");
  return dataLines.map((line) => {
    const tokens = line.trim().split(/\s+/);
    return {
      name: tokens[nameIndex >= 0 ? nameIndex : 0] ?? "",
      emb: tokens[embIndex >= 0 ? embIndex : 2] ?? "",
    };
  });
};

const assertEmbeddedDejaVuSans = (pdffonts: string): void => {
  const embeddedDejaVu = pdfFontRows(pdffonts).some((row) =>
    /dejavu[\s-]*sans/i.test(row.name ?? "") && (row.emb ?? "").toLowerCase() === "yes"
  );
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

/**
 * Infrastructure adapter implementing the application's `PdfRenderer` port by
 * delegating to `renderRestrictedSvgToPdf`. Infrastructure depending on the
 * application port (rather than the reverse) is the intended direction.
 */
export class RsvgPdfRenderer implements PdfRenderer {
  private readonly dependencies: PdfRenderDependencies;
  private readonly baseOptions: PdfRenderOptions;

  constructor(dependencies: PdfRenderDependencies, baseOptions: PdfRenderOptions = {}) {
    this.dependencies = dependencies;
    this.baseOptions = baseOptions;
  }

  render(
    svg: string,
    requiredTextTokens: readonly string[],
    options: PdfRenderOptions = {},
  ): Promise<PdfRenderResult> {
    return renderRestrictedSvgToPdf(svg, requiredTextTokens, this.dependencies, {
      ...this.baseOptions,
      ...options,
    });
  }
}
