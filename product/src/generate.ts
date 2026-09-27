import { createHash } from "node:crypto";

import {
  type Diagnostic,
  type GenerationRequest,
  type HolidayScope,
} from "./contracts.ts";
import type { HolidayResolution } from "./holiday-resolver.ts";
import {
  buildLayoutDocument,
  type LayoutDocument,
} from "./layout-ir.ts";
import {
  deriveMonthlyCalendarLayout,
  PROPOSED_COMPACT_HEADER_A4_POLICY,
} from "./layout-policy.ts";
import { buildMonthlyCalendar, type MonthlyCalendar } from "./month.ts";
import {
  renderRestrictedSvgToPdf,
  type InspectedPdfArtifact,
  type PdfRenderDependencies,
  type PdfRenderOptions,
} from "./pdf.ts";
import { validateGenerationRequest } from "./request.ts";
import { serializeRestrictedSvg } from "./svg.ts";
import { deriveWritableRegions } from "./writable-regions.ts";

/** The application-facing subset of HolidayResolver required by generation. */
export interface HolidayResolverCompatible {
  resolve(year: number, scope: HolidayScope): Promise<HolidayResolution>;
}

/**
 * Adapter seams owned by the composition root. The service deliberately has no
 * transport, repository, process, or filesystem knowledge of its own.
 */
export interface GenerationServiceDependencies {
  readonly holidayResolver: HolidayResolverCompatible;
  readonly pdf: PdfRenderDependencies;
  readonly pdfOptions?: PdfRenderOptions;
}

export interface GenerationTraceMetadata {
  readonly layoutVersion: LayoutDocument["version"];
  readonly templateId: LayoutDocument["templateId"];
  readonly irSha256: string;
  readonly svgSha256: string;
}

export interface RejectedGenerationResult {
  readonly ok: false;
  readonly diagnostics: readonly Diagnostic[];
}

export interface CompletedGenerationResult {
  readonly ok: true;
  readonly request: GenerationRequest;
  readonly artifact: InspectedPdfArtifact;
  readonly calendar: MonthlyCalendar;
  readonly holidayVerification: "verified" | "unverified";
  readonly diagnostics: readonly Diagnostic[];
  readonly document: LayoutDocument;
  readonly svg: string;
  readonly trace: GenerationTraceMetadata;
}

export type GenerationServiceResult =
  | RejectedGenerationResult
  | CompletedGenerationResult;

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const requiredPdfText = (document: LayoutDocument): readonly string[] =>
  [...new Set(document.elements.flatMap((element) =>
    element.kind === "text" && element.text !== "" ? [element.text] : []
  ))];

/**
 * Generates the fixed v1 vertical monthly calendar through the canonical
 * calendar, layout, SVG, and inspected-PDF pipeline. This is the sole module
 * that joins holiday resolution with PDF rendering.
 */
export const generateMonthlyCalendarPdf = async (
  input: unknown,
  dependencies: GenerationServiceDependencies,
): Promise<GenerationServiceResult> => {
  const validation = validateGenerationRequest(input);
  if (!validation.ok) {
    return { ok: false, diagnostics: validation.diagnostics };
  }

  const request = validation.value;
  const holidayResolution = await dependencies.holidayResolver.resolve(
    request.year,
    request.holidayScope,
  );
  const calendar = buildMonthlyCalendar(request, holidayResolution);
  const layout = deriveMonthlyCalendarLayout(
    calendar,
    PROPOSED_COMPACT_HEADER_A4_POLICY,
  );
  const writableRegions = deriveWritableRegions(layout, calendar);
  const document = buildLayoutDocument(calendar, layout, writableRegions);
  const svg = serializeRestrictedSvg(document);
  const pdf = await renderRestrictedSvgToPdf(
    svg,
    requiredPdfText(document),
    dependencies.pdf,
    dependencies.pdfOptions,
  );

  return {
    ok: true,
    request,
    artifact: pdf.artifact,
    calendar,
    holidayVerification: calendar.holidayVerification,
    diagnostics: calendar.holidayDiagnostics,
    document,
    svg,
    trace: {
      layoutVersion: document.version,
      templateId: document.templateId,
      irSha256: sha256(JSON.stringify(document)),
      svgSha256: sha256(svg),
    },
  };
};
