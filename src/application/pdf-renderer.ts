/**
 * Application-owned PDF rendering port. The application layer depends only on
 * this interface, never on a concrete renderer; infrastructure adapters
 * implement it (dependency inversion).
 */

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

/** Renders a restricted SVG document into an inspected PDF artifact. */
export interface PdfRenderer {
  render(
    svg: string,
    requiredTextTokens: readonly string[],
    options?: PdfRenderOptions,
  ): Promise<PdfRenderResult>;
}
