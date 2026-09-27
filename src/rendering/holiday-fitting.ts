import type { PhysicalBox } from "../domain/layout-policy.ts";

/** All physical dimensions and font sizes are expressed in micrometres. */
export const PROPOSED_HOLIDAY_FONT_SIZE_UM = 3_000;
export const MINIMUM_HOLIDAY_FONT_SIZE_UM = 2_116;

export interface HolidayTextMetrics {
  /**
   * This seam deliberately has no host-font dependency. Replace this
   * deterministic approximation with DejaVu Sans renderer measurements when
   * the renderer integration becomes available.
   */
  measureWidth(text: string, fontSizeUm: number): number;
  lineHeight(fontSizeUm: number): number;
}

export interface HolidayLabelFittingDiagnostic {
  readonly code: "holiday-label-truncated";
  readonly severity: "warning";
  readonly message: string;
  readonly nodeId: string;
  readonly originalLabel: string;
}

export interface HolidayLabelFit {
  readonly lines: readonly string[];
  readonly fontSizeUm: number;
  readonly truncated: boolean;
  readonly originalLabel: string;
  readonly box: PhysicalBox;
  readonly diagnostics: readonly HolidayLabelFittingDiagnostic[];
}

export interface HolidayLabelFittingInput {
  readonly nodeId: string;
  /** A pre-normalized inamovible or trasladable Argentine national holiday label. */
  readonly label: string;
  /** The preallocated holiday annotation box; fitting never changes this box. */
  readonly box: PhysicalBox;
  readonly metrics?: HolidayTextMetrics;
}

export class HolidayLabelLayoutError extends RangeError {
  readonly nodeId: string;

  constructor(nodeId: string, message: string) {
    super(`Holiday label layout error for ${nodeId}: ${message}`);
    this.name = "HolidayLabelLayoutError";
    this.nodeId = nodeId;
  }
}

/**
 * Conservative fallback advances used until renderer-provided measurements are
 * available. The 0.55 em letter factor deliberately exceeds the former 0.50
 * em average, reducing long labels before they cross their fixed annotation
 * box boundary. Whitespace and punctuation use 0.30 em because their DejaVu
 * Sans glyphs are narrower than letters.
 */
const DETERMINISTIC_LETTER_ADVANCE_UNITS = 11;
const DETERMINISTIC_NARROW_ADVANCE_UNITS = 6;
const DETERMINISTIC_ADVANCE_DENOMINATOR = 20;

const isNarrowCharacter = (character: string): boolean =>
  /[\s&<>"'.,:;!?…()\-]/u.test(character);

/**
 * A deterministic temporary metric approximation. It intentionally avoids
 * browser, operating-system, locale, renderer, and font APIs.
 */
export const DETERMINISTIC_HOLIDAY_TEXT_METRICS: HolidayTextMetrics = {
  measureWidth: (text, fontSizeUm) => Math.ceil(
    (Array.from(text).reduce(
      (advanceUnits, character) => advanceUnits + (
        isNarrowCharacter(character)
          ? DETERMINISTIC_NARROW_ADVANCE_UNITS
          : DETERMINISTIC_LETTER_ADVANCE_UNITS
      ),
      0,
    ) * fontSizeUm) / DETERMINISTIC_ADVANCE_DENOMINATOR,
  ),
  lineHeight: (fontSizeUm) => Math.ceil(fontSizeUm * 1.2),
};

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPositiveInteger = (value: unknown): value is number =>
  isNonNegativeInteger(value) && value > 0;

const assertInput = ({ nodeId, label, box }: HolidayLabelFittingInput): void => {
  if (typeof nodeId !== "string" || nodeId === "") {
    throw new HolidayLabelLayoutError("unknown", "a non-empty node id is required.");
  }
  if (
    typeof label !== "string" ||
    label === "" ||
    label !== label.trim() ||
    /\s{2,}/u.test(label)
  ) {
    throw new HolidayLabelLayoutError(nodeId, "label must be a non-empty normalized string.");
  }
  if (
    typeof box !== "object" ||
    box === null ||
    !isNonNegativeInteger(box.x) ||
    !isNonNegativeInteger(box.y) ||
    !isPositiveInteger(box.width) ||
    !isPositiveInteger(box.height)
  ) {
    throw new HolidayLabelLayoutError(nodeId, "box must be a positive fixed physical-unit box.");
  }
};

const measuredWidth = (
  metrics: HolidayTextMetrics,
  text: string,
  fontSizeUm: number,
  nodeId: string,
): number => {
  const width = metrics.measureWidth(text, fontSizeUm);
  if (!isNonNegativeInteger(width)) {
    throw new HolidayLabelLayoutError(nodeId, "text metrics must return non-negative integer widths.");
  }
  return width;
};

const measuredLineHeight = (
  metrics: HolidayTextMetrics,
  fontSizeUm: number,
  nodeId: string,
): number => {
  const height = metrics.lineHeight(fontSizeUm);
  if (!isPositiveInteger(height)) {
    throw new HolidayLabelLayoutError(nodeId, "text metrics must return positive integer line heights.");
  }
  return height;
};

const wrapWords = (
  label: string,
  fontSizeUm: number,
  box: PhysicalBox,
  metrics: HolidayTextMetrics,
  nodeId: string,
): readonly string[] | undefined => {
  const lines: string[] = [];
  let line = "";

  for (const word of label.split(" ")) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (measuredWidth(metrics, candidate, fontSizeUm, nodeId) <= box.width) {
      line = candidate;
      continue;
    }

    if (line === "") return undefined;
    lines.push(line);
    line = word;
    if (lines.length >= 2 || measuredWidth(metrics, line, fontSizeUm, nodeId) > box.width) {
      return undefined;
    }
  }

  if (line !== "") lines.push(line);
  const lineHeight = measuredLineHeight(metrics, fontSizeUm, nodeId);
  return lines.length <= 2 && lineHeight * lines.length <= box.height ? lines : undefined;
};

const fitSingleLine = (
  label: string,
  box: PhysicalBox,
  metrics: HolidayTextMetrics,
  nodeId: string,
): Pick<HolidayLabelFit, "lines" | "fontSizeUm"> | undefined => {
  for (let fontSizeUm = PROPOSED_HOLIDAY_FONT_SIZE_UM;
    fontSizeUm >= MINIMUM_HOLIDAY_FONT_SIZE_UM;
    fontSizeUm -= 1) {
    if (
      measuredWidth(metrics, label, fontSizeUm, nodeId) <= box.width &&
      measuredLineHeight(metrics, fontSizeUm, nodeId) <= box.height
    ) {
      return { lines: [label], fontSizeUm };
    }
  }
  return undefined;
};

const fitWithoutTruncation = (
  label: string,
  box: PhysicalBox,
  metrics: HolidayTextMetrics,
  nodeId: string,
): Pick<HolidayLabelFit, "lines" | "fontSizeUm"> | undefined => {
  const singleLine = fitSingleLine(label, box, metrics, nodeId);
  if (singleLine) return singleLine;

  for (let fontSizeUm = PROPOSED_HOLIDAY_FONT_SIZE_UM;
    fontSizeUm >= MINIMUM_HOLIDAY_FONT_SIZE_UM;
    fontSizeUm -= 1) {
    const lines = wrapWords(label, fontSizeUm, box, metrics, nodeId);
    if (lines) return { lines, fontSizeUm };
  }
  return undefined;
};

const truncatedCandidates = (label: string): readonly string[] => {
  const characters = Array.from(label);
  const candidates = new Set<string>();

  for (let index = characters.length; index > 0; index -= 1) {
    if (index === characters.length || characters[index] === " ") {
      candidates.add(`${characters.slice(0, index).join("").trimEnd()}…`);
    }
  }
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    candidates.add(`${characters.slice(0, index).join("").trimEnd()}…`);
  }
  candidates.add("…");
  return [...candidates];
};

const fitWithTruncation = (
  label: string,
  box: PhysicalBox,
  metrics: HolidayTextMetrics,
  nodeId: string,
): readonly string[] | undefined => {
  for (const candidate of truncatedCandidates(label)) {
    const lines = wrapWords(candidate, MINIMUM_HOLIDAY_FONT_SIZE_UM, box, metrics, nodeId);
    if (lines) return lines;
  }
  return undefined;
};

/**
 * Fits a normalized holiday label solely inside its supplied annotation box.
 * It never alters geometry, so it cannot consume the adjacent protected
 * writable region.
 */
export const fitHolidayLabel = (input: HolidayLabelFittingInput): HolidayLabelFit => {
  assertInput(input);
  const metrics = input.metrics ?? DETERMINISTIC_HOLIDAY_TEXT_METRICS;
  const untruncated = fitWithoutTruncation(input.label, input.box, metrics, input.nodeId);

  if (untruncated) {
    return {
      ...untruncated,
      truncated: false,
      originalLabel: input.label,
      box: input.box,
      diagnostics: [],
    };
  }

  const lines = fitWithTruncation(input.label, input.box, metrics, input.nodeId);
  if (!lines) {
    throw new HolidayLabelLayoutError(input.nodeId, "even an ellipsis cannot fit inside the annotation box.");
  }

  return {
    lines,
    fontSizeUm: MINIMUM_HOLIDAY_FONT_SIZE_UM,
    truncated: true,
    originalLabel: input.label,
    box: input.box,
    diagnostics: [{
      code: "holiday-label-truncated",
      severity: "warning",
      message: "Holiday label was truncated to fit its annotation box.",
      nodeId: input.nodeId,
      originalLabel: input.label,
    }],
  };
};
