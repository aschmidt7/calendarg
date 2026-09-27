import type { Diagnostic } from "./contracts.ts";
import {
  DETERMINISTIC_HOLIDAY_TEXT_METRICS,
  fitHolidayLabel,
  MINIMUM_HOLIDAY_FONT_SIZE_UM,
  PROPOSED_HOLIDAY_FONT_SIZE_UM,
} from "./holiday-fitting.ts";
import { A4_PAGE_UM, type MonthlyCalendarLayout, type PhysicalBox } from "./layout-policy.ts";
import type { MonthlyCalendar } from "./month.ts";
import { WRITABLE_REGION_POLICY, type WritableRegionLayout } from "./writable-regions.ts";

export const LAYOUT_DOCUMENT_VERSION = "1.0.0";
export const MONTHLY_CALENDAR_TEMPLATE_ID = "monthly-calendar-a4-vertical-v1";
export const DEJAVU_SANS_FONT_TOKEN = "dejavu-sans@1.0.0";
export const BLACK_TEXT_STYLE_TOKEN = "black";
export const ADJACENT_DAY_NUMBER_STYLE_TOKEN = "adjacent-day-gray";
export const HEADING_FONT_SIZE_UM = 5_000;
export const WEEKDAY_HEADER_FONT_SIZE_UM = 3_000;
export const DAY_NUMBER_FONT_SIZE_UM = 4_200;
export const ADJACENT_DAY_NUMBER_FONT_SIZE_UM = 4_200;

const A4_SAFE_AREA: PhysicalBox = {
  x: 10_000,
  y: 10_000,
  width: 190_000,
  height: 277_000,
};

type RectangleRole = "page" | "grid" | "cell";
type TextRole =
  | "heading"
  | "weekday-header"
  | "day-number"
  | "adjacent-day-number"
  | "holiday-label";

export type LayoutRole = RectangleRole | TextRole;
export type TextStyleToken =
  | typeof BLACK_TEXT_STYLE_TOKEN
  | typeof ADJACENT_DAY_NUMBER_STYLE_TOKEN;
export type TextAnchor = "start" | "middle";
export type DominantBaseline = "hanging" | "middle";

interface LayoutElementBase {
  readonly id: string;
  readonly z: number;
  readonly role: LayoutRole;
  readonly box: PhysicalBox;
}

export interface LayoutRectangle extends LayoutElementBase {
  readonly kind: "rectangle";
  readonly role: RectangleRole;
  readonly rowIndex?: number;
  readonly columnIndex?: number;
}

export interface LayoutText extends LayoutElementBase {
  readonly kind: "text";
  readonly role: TextRole;
  readonly text: string;
  readonly styleToken: TextStyleToken;
  readonly fontToken: typeof DEJAVU_SANS_FONT_TOKEN;
  readonly fontSizeUm: number;
  /** SVG text anchor defining horizontal placement inside the physical box. */
  readonly textAnchor: TextAnchor;
  /** SVG dominant baseline defining vertical placement inside the physical box. */
  readonly dominantBaseline: DominantBaseline;
  readonly rowIndex?: number;
  readonly columnIndex?: number;
  readonly isoDate?: string;
  /** Present only on ordered holiday-label line elements. */
  readonly lineIndex?: 0 | 1;
  /** Present only on holiday-label line elements fitted by the truncation fallback. */
  readonly truncated?: boolean;
}

export type LayoutElement = LayoutRectangle | LayoutText;

export interface LayoutProtectedRegion {
  readonly id: string;
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly isoDate: string;
  readonly box: PhysicalBox;
}

export interface LayoutDocument {
  readonly version: typeof LAYOUT_DOCUMENT_VERSION;
  readonly templateId: typeof MONTHLY_CALENDAR_TEMPLATE_ID;
  readonly page: { readonly width: number; readonly height: number };
  readonly safeArea: PhysicalBox;
  readonly matrix: { readonly rowCount: 5 | 6; readonly columnCount: 7 };
  readonly elements: readonly LayoutElement[];
  readonly protectedRegions: readonly LayoutProtectedRegion[];
  readonly diagnostics: readonly Diagnostic[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPositiveInteger = (value: unknown): value is number =>
  isNonNegativeInteger(value) && value > 0;

const isBox = (value: unknown): value is PhysicalBox =>
  isRecord(value) &&
  isNonNegativeInteger(value.x) &&
  isNonNegativeInteger(value.y) &&
  isPositiveInteger(value.width) &&
  isPositiveInteger(value.height);

const sameBox = (left: PhysicalBox, right: PhysicalBox): boolean =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;

const isInside = (inner: PhysicalBox, outer: PhysicalBox): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

const overlaps = (left: PhysicalBox, right: PhysicalBox): boolean =>
  left.x < right.x + right.width &&
  right.x < left.x + left.width &&
  left.y < right.y + right.height &&
  right.y < left.y + left.height;

const cloneBox = (box: PhysicalBox): PhysicalBox => ({ ...box });

const dayNumberAnnotationBoxForCell = (cellBox: PhysicalBox): PhysicalBox => ({
  x: cellBox.x + WRITABLE_REGION_POLICY.horizontalInset,
  y: cellBox.y + WRITABLE_REGION_POLICY.dayNumber.top,
  width: cellBox.width - WRITABLE_REGION_POLICY.horizontalInset * 2,
  height: WRITABLE_REGION_POLICY.dayNumber.bottom - WRITABLE_REGION_POLICY.dayNumber.top,
});

const holidayAnnotationBoxForCell = (cellBox: PhysicalBox): PhysicalBox => ({
  x: cellBox.x + WRITABLE_REGION_POLICY.horizontalInset,
  y: cellBox.y + WRITABLE_REGION_POLICY.holidayLabel.top,
  width: cellBox.width - WRITABLE_REGION_POLICY.horizontalInset * 2,
  height: WRITABLE_REGION_POLICY.holidayLabel.bottom - WRITABLE_REGION_POLICY.holidayLabel.top,
});

const holidayLineBox = (
  annotationBox: PhysicalBox,
  fontSizeUm: number,
  lineIndex: number,
): PhysicalBox => ({
  x: annotationBox.x,
  y: annotationBox.y + DETERMINISTIC_HOLIDAY_TEXT_METRICS.lineHeight(fontSizeUm) * lineIndex,
  width: annotationBox.width,
  height: DETERMINISTIC_HOLIDAY_TEXT_METRICS.lineHeight(fontSizeUm),
});

const freezeDeep = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
};

const coordinateKey = (rowIndex: number, columnIndex: number): string =>
  `${rowIndex}:${columnIndex}`;

const assertCalendarAndLayout = (
  calendar: MonthlyCalendar,
  layout: MonthlyCalendarLayout,
  writableRegions: WritableRegionLayout,
): void => {
  if (
    !Array.isArray(calendar?.weeks) ||
    (calendar.weeks.length !== 5 && calendar.weeks.length !== 6) ||
    layout?.rowCount !== calendar.weeks.length ||
    layout.columnCount !== 7 ||
    !Array.isArray(layout.cells) ||
    layout.cells.length !== calendar.weeks.length * 7 ||
    !Array.isArray(layout.weekdayBoxes) ||
    layout.weekdayBoxes.length !== 7 ||
    !isBox(layout.headingBox) ||
    !isBox(layout.gridBox) ||
    layout.page?.width !== A4_PAGE_UM.width ||
    layout.page?.height !== A4_PAGE_UM.height ||
    !isBox(layout.page?.safeArea) ||
    !sameBox(layout.page.safeArea, A4_SAFE_AREA) ||
    !Array.isArray(writableRegions?.annotations) ||
    !Array.isArray(writableRegions?.protectedRegions)
  ) {
    throw new RangeError("Layout IR inputs must describe the fixed A4 seven-column calendar.");
  }

  for (const week of calendar.weeks) {
    if (!Array.isArray(week) || week.length !== 7) {
      throw new RangeError("Layout IR inputs must describe the fixed A4 seven-column calendar.");
    }
  }
};

const annotationMap = (writableRegions: WritableRegionLayout): Map<string, WritableRegionLayout["annotations"][number]> => {
  const annotations = new Map<string, WritableRegionLayout["annotations"][number]>();
  for (const annotation of writableRegions.annotations) {
    if (
      !Number.isInteger(annotation?.rowIndex) ||
      !Number.isInteger(annotation?.columnIndex) ||
      !isBox(annotation.dayNumberBox) ||
      !isBox(annotation.holidayLabelBox) ||
      annotations.has(coordinateKey(annotation.rowIndex, annotation.columnIndex))
    ) {
      throw new RangeError("Writable region annotations must be unique valid cell geometry.");
    }
    annotations.set(coordinateKey(annotation.rowIndex, annotation.columnIndex), annotation);
  }
  if (annotations.size === 0) {
    throw new RangeError("Writable region annotations must cover every calendar cell.");
  }
  return annotations;
};

const protectedRegionMap = (writableRegions: WritableRegionLayout): Map<string, WritableRegionLayout["protectedRegions"][number]> => {
  const regions = new Map<string, WritableRegionLayout["protectedRegions"][number]>();
  for (const region of writableRegions.protectedRegions) {
    const key = coordinateKey(region?.rowIndex, region?.columnIndex);
    if (
      !Number.isInteger(region?.rowIndex) ||
      !Number.isInteger(region?.columnIndex) ||
      typeof region?.isoDate !== "string" ||
      !isBox(region.box) ||
      regions.has(key)
    ) {
      throw new RangeError("Protected regions must be unique valid current-month cell geometry.");
    }
    regions.set(key, region);
  }
  return regions;
};

export const buildLayoutDocument = (
  calendar: MonthlyCalendar,
  layout: MonthlyCalendarLayout,
  writableRegions: WritableRegionLayout,
): LayoutDocument => {
  assertCalendarAndLayout(calendar, layout, writableRegions);
  const annotations = annotationMap(writableRegions);
  const protectedRegions = protectedRegionMap(writableRegions);
  const cells = new Map(layout.cells.map((cell) => [coordinateKey(cell.rowIndex, cell.columnIndex), cell]));
  const elements: LayoutElement[] = [];
  const fittingDiagnostics: Diagnostic[] = [];
  const add = <T extends Omit<LayoutElement, "z">>(element: T): void => {
    elements.push({ ...element, z: elements.length } as LayoutElement);
  };

  add({ id: "page", kind: "rectangle", role: "page", box: { x: 0, y: 0, ...layout.page } });
  add({ id: "grid", kind: "rectangle", role: "grid", box: cloneBox(layout.gridBox) });
  for (let rowIndex = 0; rowIndex < layout.rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < 7; columnIndex += 1) {
      const cell = cells.get(coordinateKey(rowIndex, columnIndex));
      if (!cell || !isBox(cell.box)) throw new RangeError("Layout cells must cover every matrix coordinate.");
      add({
        id: `cell-${rowIndex}-${columnIndex}`,
        kind: "rectangle",
        role: "cell",
        rowIndex,
        columnIndex,
        box: cloneBox(cell.box),
      });
    }
  }
  add({
    id: "heading",
    kind: "text",
    role: "heading",
    text: calendar.heading,
    styleToken: BLACK_TEXT_STYLE_TOKEN,
    fontToken: DEJAVU_SANS_FONT_TOKEN,
    fontSizeUm: HEADING_FONT_SIZE_UM,
    textAnchor: "middle",
    dominantBaseline: "middle",
    box: cloneBox(layout.headingBox),
  });
  for (let columnIndex = 0; columnIndex < 7; columnIndex += 1) {
    add({
      id: `weekday-header-${columnIndex}`,
      kind: "text",
      role: "weekday-header",
      text: calendar.weekdayHeaders[columnIndex],
      styleToken: BLACK_TEXT_STYLE_TOKEN,
      fontToken: DEJAVU_SANS_FONT_TOKEN,
      fontSizeUm: WEEKDAY_HEADER_FONT_SIZE_UM,
      textAnchor: "middle",
      dominantBaseline: "middle",
      columnIndex,
      box: cloneBox(layout.weekdayBoxes[columnIndex]),
    });
  }

  const documentProtectedRegions: LayoutProtectedRegion[] = [];
  if (annotations.size !== layout.rowCount * 7) {
    throw new RangeError("Writable region annotations must cover every calendar cell exactly once.");
  }

  for (let rowIndex = 0; rowIndex < layout.rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < 7; columnIndex += 1) {
      const cell = calendar.weeks[rowIndex][columnIndex];
      const annotation = annotations.get(coordinateKey(rowIndex, columnIndex));
      if (!annotation) throw new RangeError("Each calendar cell requires annotation geometry.");
      const current = cell.membership === "current";
      add({
        id: `${current ? "day-number" : "adjacent-day-number"}-${rowIndex}-${columnIndex}`,
        kind: "text",
        role: current ? "day-number" : "adjacent-day-number",
        text: String(cell.dayNumber),
        styleToken: current ? BLACK_TEXT_STYLE_TOKEN : ADJACENT_DAY_NUMBER_STYLE_TOKEN,
        fontToken: DEJAVU_SANS_FONT_TOKEN,
        fontSizeUm: current ? DAY_NUMBER_FONT_SIZE_UM : ADJACENT_DAY_NUMBER_FONT_SIZE_UM,
        textAnchor: "start",
        dominantBaseline: "hanging",
        rowIndex,
        columnIndex,
        isoDate: cell.isoDate,
        box: cloneBox(annotation.dayNumberBox),
      });
      if (current) {
        const protectedRegion = protectedRegions.get(coordinateKey(rowIndex, columnIndex));
        if (!protectedRegion || protectedRegion.isoDate !== cell.isoDate) {
          throw new RangeError("Each current-month cell requires its protected region.");
        }
        documentProtectedRegions.push({
          id: `protected-${rowIndex}-${columnIndex}`,
          rowIndex,
          columnIndex,
          isoDate: cell.isoDate,
          box: cloneBox(protectedRegion.box),
        });
        if (calendar.holidayVerification === "verified" && cell.holiday) {
          const nodeId = `holiday-label-${rowIndex}-${columnIndex}`;
          const fit = fitHolidayLabel({
            nodeId,
            label: cell.holiday.label,
            box: cloneBox(annotation.holidayLabelBox),
            metrics: DETERMINISTIC_HOLIDAY_TEXT_METRICS,
          });
          for (let lineIndex = 0; lineIndex < fit.lines.length; lineIndex += 1) {
            add({
              id: `${nodeId}-${lineIndex}`,
              kind: "text",
              role: "holiday-label",
              text: fit.lines[lineIndex],
              styleToken: BLACK_TEXT_STYLE_TOKEN,
              fontToken: DEJAVU_SANS_FONT_TOKEN,
              fontSizeUm: fit.fontSizeUm,
              textAnchor: "start",
              dominantBaseline: "hanging",
              rowIndex,
              columnIndex,
              isoDate: cell.isoDate,
              lineIndex: lineIndex as 0 | 1,
              truncated: fit.truncated,
              box: holidayLineBox(annotation.holidayLabelBox, fit.fontSizeUm, lineIndex),
            });
          }
          fittingDiagnostics.push(...fit.diagnostics.map((diagnostic) => ({
            code: diagnostic.code,
            severity: diagnostic.severity,
            message: diagnostic.message,
            path: ["elements", diagnostic.nodeId],
          })));
        }
      }
    }
  }

  if (documentProtectedRegions.length !== protectedRegions.size) {
    throw new RangeError("Protected regions may only target current-month cells.");
  }

  const document: LayoutDocument = {
    version: LAYOUT_DOCUMENT_VERSION,
    templateId: MONTHLY_CALENDAR_TEMPLATE_ID,
    page: { width: layout.page.width, height: layout.page.height },
    safeArea: cloneBox(layout.page.safeArea),
    matrix: { rowCount: layout.rowCount as 5 | 6, columnCount: 7 },
    elements,
    protectedRegions: documentProtectedRegions,
    diagnostics: [
      ...calendar.holidayDiagnostics.map((diagnostic) => ({
        ...diagnostic,
        path: [...diagnostic.path],
      })),
      ...fittingDiagnostics,
    ],
  };
  validateLayoutDocument(document);
  return freezeDeep(document);
};

const allowedRoles = new Set<LayoutRole>([
  "page",
  "grid",
  "cell",
  "heading",
  "weekday-header",
  "day-number",
  "adjacent-day-number",
  "holiday-label",
]);

const assertElement = (element: unknown, safeArea: PhysicalBox, index: number): asserts element is LayoutElement => {
  if (!isRecord(element) || typeof element.id !== "string" || element.id === "" || element.z !== index) {
    throw new RangeError("Layout elements must have stable IDs and canonical z-order.");
  }
  if (!allowedRoles.has(element.role as LayoutRole)) {
    throw new RangeError("Layout element role is not allowed by v1.");
  }
  if (!isBox(element.box)) throw new RangeError("Layout elements must have positive physical boxes.");
  if (element.role !== "page" && !isInside(element.box, safeArea)) {
    throw new RangeError("Layout element containment must remain inside the safe area.");
  }
  const rectangle = element.role === "page" || element.role === "grid" || element.role === "cell";
  if ((rectangle && element.kind !== "rectangle") || (!rectangle && element.kind !== "text")) {
    throw new RangeError("Layout element kind is incompatible with its v1 role.");
  }
  if (!rectangle && element.styleToken !== (element.role === "adjacent-day-number"
    ? ADJACENT_DAY_NUMBER_STYLE_TOKEN
    : BLACK_TEXT_STYLE_TOKEN)) {
    throw new RangeError("Layout text must use the approved role-specific style token.");
  }
  if (!rectangle && (
    typeof element.text !== "string" ||
    element.fontToken !== DEJAVU_SANS_FONT_TOKEN ||
    !isPositiveInteger(element.fontSizeUm) ||
    (element.role === "heading" && element.fontSizeUm !== HEADING_FONT_SIZE_UM) ||
    (element.role === "weekday-header" && element.fontSizeUm !== WEEKDAY_HEADER_FONT_SIZE_UM) ||
    (element.role === "day-number" && element.fontSizeUm !== DAY_NUMBER_FONT_SIZE_UM) ||
    (element.role === "adjacent-day-number" && element.fontSizeUm !== ADJACENT_DAY_NUMBER_FONT_SIZE_UM) ||
    (element.role === "heading" || element.role === "weekday-header"
      ? element.textAnchor !== "middle" || element.dominantBaseline !== "middle"
      : element.textAnchor !== "start" || element.dominantBaseline !== "hanging")
  )) {
    throw new RangeError("Layout text must use the approved font, size, and role-specific anchor semantics.");
  }
};

export const validateLayoutDocument = (value: unknown): asserts value is LayoutDocument => {
  if (!isRecord(value) || value.version !== LAYOUT_DOCUMENT_VERSION || value.templateId !== MONTHLY_CALENDAR_TEMPLATE_ID) {
    throw new RangeError("Layout document must use the supported v1 template.");
  }
  if (
    !isRecord(value.page) ||
    value.page.width !== A4_PAGE_UM.width ||
    value.page.height !== A4_PAGE_UM.height
  ) {
    throw new RangeError("Layout document page must be fixed A4.");
  }
  if (!isBox(value.safeArea) || !sameBox(value.safeArea, A4_SAFE_AREA)) {
    throw new RangeError("Layout document safe area must be the fixed A4 safe area.");
  }
  if (
    !isRecord(value.matrix) ||
    (value.matrix.rowCount !== 5 && value.matrix.rowCount !== 6) ||
    value.matrix.columnCount !== 7 ||
    !Array.isArray(value.elements) ||
    !Array.isArray(value.protectedRegions) ||
    !Array.isArray(value.diagnostics)
  ) {
    throw new RangeError("Layout document must have a five- or six-row seven-column matrix.");
  }

  const safeArea = value.safeArea;
  const ids = new Set<string>();
  for (let index = 0; index < value.elements.length; index += 1) {
    const element = value.elements[index];
    assertElement(element, safeArea, index);
    if (ids.has(element.id)) throw new RangeError("Layout element IDs must be stable and unique.");
    ids.add(element.id);
  }

  const cellCount = value.matrix.rowCount * 7;
  const prefixRoles: LayoutRole[] = [
    "page",
    "grid",
    ...Array(cellCount).fill("cell") as LayoutRole[],
    "heading",
    ...Array(7).fill("weekday-header") as LayoutRole[],
  ];
  if (value.elements.length < prefixRoles.length || prefixRoles.some((role, index) => value.elements[index].role !== role)) {
    throw new RangeError("Layout elements must use canonical page, grid, cell, header order.");
  }

  const cellBoxes = new Map<string, PhysicalBox>();
  for (let rowIndex = 0; rowIndex < value.matrix.rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < 7; columnIndex += 1) {
      const element = value.elements[2 + rowIndex * 7 + columnIndex];
      const key = coordinateKey(rowIndex, columnIndex);
      if (
        element.id !== `cell-${rowIndex}-${columnIndex}` ||
        element.rowIndex !== rowIndex ||
        element.columnIndex !== columnIndex
      ) {
        throw new RangeError("Layout cells must cover each of the seven matrix columns exactly once.");
      }
      cellBoxes.set(key, element.box);
    }
  }

  let cursor = prefixRoles.length;
  const currentCells = new Set<string>();
  const currentDates = new Map<string, string>();
  const holidayLinesByCell = new Map<string, LayoutText[]>();
  for (let rowIndex = 0; rowIndex < value.matrix.rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < 7; columnIndex += 1) {
      const key = coordinateKey(rowIndex, columnIndex);
      const day = value.elements[cursor];
      if (!day || (day.role !== "day-number" && day.role !== "adjacent-day-number") || day.rowIndex !== rowIndex || day.columnIndex !== columnIndex) {
        throw new RangeError("Day text must follow matrix order.");
      }
      const current = day.role === "day-number";
      const expectedId = `${current ? "day-number" : "adjacent-day-number"}-${rowIndex}-${columnIndex}`;
      const cellBox = cellBoxes.get(key)!;
      if (
        day.id !== expectedId ||
        !sameBox(day.box, dayNumberAnnotationBoxForCell(cellBox)) ||
        day.box.y <= cellBox.y
      ) {
        throw new RangeError("Day text must use its padded annotation box below the grid border.");
      }
      cursor += 1;
      if (current) {
        currentCells.add(key);
        if (typeof day.isoDate !== "string") {
          throw new RangeError("Current-month day text must identify its ISO date.");
        }
        currentDates.set(key, day.isoDate);
      }
      const holidayLines: LayoutText[] = [];
      while (value.elements[cursor]?.role === "holiday-label") {
        if (holidayLines.length === 2) {
          throw new RangeError("Holiday labels may contain only one or two ordered lines.");
        }
        holidayLines.push(value.elements[cursor] as LayoutText);
        cursor += 1;
      }
      if (holidayLines.length > 0) {
        const annotationBox = holidayAnnotationBoxForCell(cellBox);
        const firstLine = holidayLines[0];
        for (let lineIndex = 0; lineIndex < holidayLines.length; lineIndex += 1) {
          const holiday = holidayLines[lineIndex];
          const expectedBox = holidayLineBox(annotationBox, firstLine.fontSizeUm, lineIndex);
          if (
            !current ||
            holiday.id !== `holiday-label-${rowIndex}-${columnIndex}-${lineIndex}` ||
            holiday.rowIndex !== rowIndex ||
            holiday.columnIndex !== columnIndex ||
            holiday.isoDate !== day.isoDate ||
            holiday.lineIndex !== lineIndex ||
            typeof holiday.truncated !== "boolean" ||
            holiday.truncated !== firstLine.truncated ||
            holiday.fontSizeUm !== firstLine.fontSizeUm ||
            holiday.fontSizeUm < MINIMUM_HOLIDAY_FONT_SIZE_UM ||
            holiday.fontSizeUm > PROPOSED_HOLIDAY_FONT_SIZE_UM ||
            holiday.text === "" ||
            holiday.text !== holiday.text.trim() ||
            /\s{2,}/u.test(holiday.text) ||
            DETERMINISTIC_HOLIDAY_TEXT_METRICS.measureWidth(holiday.text, holiday.fontSizeUm) > annotationBox.width ||
            !sameBox(holiday.box, expectedBox) ||
            !isInside(holiday.box, annotationBox) ||
            !isInside(holiday.box, cellBox)
          ) {
            throw new RangeError("Holiday label lines must be ordered, fitted, and contained in their annotation box.");
          }
        }
        holidayLinesByCell.set(key, holidayLines);
      }
    }
  }
  if (cursor !== value.elements.length) throw new RangeError("Layout elements must have canonical matrix order.");

  const protectedBoxesByCell = new Map<string, PhysicalBox>();
  for (let index = 0; index < value.protectedRegions.length; index += 1) {
    const region = value.protectedRegions[index];
    if (!isRecord(region) || !isBox(region.box)) throw new RangeError("Protected regions must have valid physical boxes.");
    for (let otherIndex = index + 1; otherIndex < value.protectedRegions.length; otherIndex += 1) {
      const other = value.protectedRegions[otherIndex];
      if (isRecord(other) && isBox(other.box) && overlaps(region.box, other.box)) {
        throw new RangeError("Protected regions must not overlap.");
      }
    }
    if (
      typeof region.id !== "string" ||
      !Number.isInteger(region.rowIndex) ||
      !Number.isInteger(region.columnIndex) ||
      typeof region.isoDate !== "string" ||
      !currentCells.has(coordinateKey(region.rowIndex, region.columnIndex)) ||
      region.isoDate !== currentDates.get(coordinateKey(region.rowIndex, region.columnIndex)) ||
      region.id !== `protected-${region.rowIndex}-${region.columnIndex}` ||
      !isInside(region.box, cellBoxes.get(coordinateKey(region.rowIndex, region.columnIndex))!)
    ) {
      throw new RangeError("Protected regions must be contained in unique current-month cells.");
    }
    const key = coordinateKey(region.rowIndex, region.columnIndex);
    if (protectedBoxesByCell.has(key)) {
      throw new RangeError("Protected regions must be unique current-month cells.");
    }
    protectedBoxesByCell.set(key, region.box);
  }
  if (value.protectedRegions.length !== currentCells.size) {
    throw new RangeError("Every current-month cell requires one protected region.");
  }
  for (const [key, holidayLines] of holidayLinesByCell) {
    const protectedBox = protectedBoxesByCell.get(key);
    if (!protectedBox || holidayLines.some((line) => overlaps(line.box, protectedBox))) {
      throw new RangeError("Holiday label lines must remain outside the protected writable region.");
    }
  }
};
