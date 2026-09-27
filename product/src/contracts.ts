export const V1_TEMPLATE = "vertical-monthly-v1" as const;
export const ARGENTINE_NATIONAL_HOLIDAY_SCOPE = "argentina-national" as const;

export type Template = typeof V1_TEMPLATE;
export type HolidayScope = typeof ARGENTINE_NATIONAL_HOLIDAY_SCOPE;

export interface GenerationRequest {
  readonly year: number;
  readonly month: number;
  readonly template: Template;
  readonly holidayScope: HolidayScope;
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly path: readonly string[];
}

export interface ValidRequest<T> {
  readonly ok: true;
  readonly value: T;
  readonly diagnostics: readonly Diagnostic[];
}

export interface InvalidRequest {
  readonly ok: false;
  readonly diagnostics: readonly Diagnostic[];
}

export type RequestValidationResult<T> = ValidRequest<T> | InvalidRequest;

export interface GeneratedPdf {
  readonly mediaType: "application/pdf";
  readonly bytes: Uint8Array;
  readonly pageCount: number;
}

export interface GenerationResult {
  readonly request: GenerationRequest;
  readonly artifact: GeneratedPdf;
  readonly holidayVerification: "verified" | "unverified";
  readonly diagnostics: readonly Diagnostic[];
}

export interface Clock {
  now(): Date;
}

export interface Transport<Request = unknown, Response = unknown> {
  send(request: Request): Promise<Response>;
}

export interface Repository<Key = unknown, Value = unknown> {
  load(key: Key): Promise<Value | undefined>;
  save(key: Key, value: Value): Promise<void>;
}

export interface Renderer<Document = unknown, Artifact = GeneratedPdf> {
  render(document: Document): Promise<Artifact>;
}

export interface GenerationPorts<
  TransportRequest = unknown,
  TransportResponse = unknown,
  RepositoryKey = unknown,
  RepositoryValue = unknown,
  RenderDocument = unknown,
  RenderArtifact = GeneratedPdf,
> {
  readonly clock: Clock;
  readonly transport: Transport<TransportRequest, TransportResponse>;
  readonly repository: Repository<RepositoryKey, RepositoryValue>;
  readonly renderer: Renderer<RenderDocument, RenderArtifact>;
}
