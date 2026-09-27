import type {
  LayoutCell,
  Micrometres,
  MonthlyCalendarLayout,
  PhysicalBox,
} from "./layout-policy.ts";
import type { MonthlyCalendar, MonthlyCalendarCell } from "./month.ts";

export const WRITABLE_REGION_POLICY_VERSION = "1.0.0-proposed";

export const WRITABLE_REGION_POLICY = {
  version: WRITABLE_REGION_POLICY_VERSION,
  horizontalInset: 1_500,
  dayNumber: { top: 1_500, bottom: 6_000 },
  holidayLabel: { top: 6_000, bottom: 14_000 },
  annotationGap: { top: 14_000, bottom: 15_500 },
  protectedWritableRegion: { top: 15_500, bottomInset: 1_500 },
} as const;

export const PROTECTED_WRITABLE_REGION_MINIMUMS_UM = {
  width: 24_142,
  height: 27_000,
  area: 651_834_000,
} as const;

export interface CellAnnotationGeometry {
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly dayNumberBox: PhysicalBox;
  readonly holidayLabelBox: PhysicalBox;
  readonly gapBox: PhysicalBox;
}

export interface ProtectedWritableRegion {
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly isoDate: string;
  readonly box: PhysicalBox;
}

export interface WritableRegionLayout {
  readonly policyVersion: typeof WRITABLE_REGION_POLICY_VERSION;
  readonly annotations: readonly CellAnnotationGeometry[];
  readonly protectedRegions: readonly ProtectedWritableRegion[];
}

const isNonNegativeInteger = (value: unknown): value is Micrometres =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPositiveInteger = (value: unknown): value is Micrometres =>
  isNonNegativeInteger(value) && value > 0;

const isPhysicalBox = (value: unknown): value is PhysicalBox => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const box = value as PhysicalBox;
  return (
    isNonNegativeInteger(box.x) &&
    isNonNegativeInteger(box.y) &&
    isPositiveInteger(box.width) &&
    isPositiveInteger(box.height)
  );
};

const hasPositiveArea = (box: PhysicalBox): boolean => box.width > 0 && box.height > 0;

const isInside = (inner: PhysicalBox, outer: PhysicalBox): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

const isStrictlyInside = (inner: PhysicalBox, outer: PhysicalBox): boolean =>
  inner.x > outer.x &&
  inner.y > outer.y &&
  inner.x + inner.width < outer.x + outer.width &&
  inner.y + inner.height < outer.y + outer.height;

const intersects = (left: PhysicalBox, right: PhysicalBox): boolean =>
  left.x < right.x + right.width &&
  right.x < left.x + left.width &&
  left.y < right.y + right.height &&
  right.y < left.y + left.height;

const boxAt = (
  cell: PhysicalBox,
  top: Micrometres,
  bottom: Micrometres,
): PhysicalBox => ({
  x: cell.x + WRITABLE_REGION_POLICY.horizontalInset,
  y: cell.y + top,
  width: cell.width - WRITABLE_REGION_POLICY.horizontalInset * 2,
  height: bottom - top,
});

const assertCalendarMatchesLayout = (
  layout: MonthlyCalendarLayout,
  calendar: MonthlyCalendar,
): void => {
  if (
    !Array.isArray(calendar?.weeks) ||
    !Number.isInteger(layout?.rowCount) ||
    layout.rowCount !== calendar.weeks.length ||
    layout.columnCount !== 7 ||
    !Array.isArray(layout.cells) ||
    layout.cells.length !== layout.rowCount * layout.columnCount
  ) {
    throw new RangeError("Calendar and layout must describe the same rectangular month matrix.");
  }

  for (const week of calendar.weeks) {
    if (!Array.isArray(week) || week.length !== layout.columnCount) {
      throw new RangeError("Calendar and layout must describe the same rectangular month matrix.");
    }
  }
};

const assertPageAndGridGeometry = (layout: MonthlyCalendarLayout): void => {
  if (
    !isPositiveInteger(layout?.page?.width) ||
    !isPositiveInteger(layout?.page?.height) ||
    !isPhysicalBox(layout.page.safeArea) ||
    !isPhysicalBox(layout.gridBox) ||
    layout.page.safeArea.x + layout.page.safeArea.width > layout.page.width ||
    layout.page.safeArea.y + layout.page.safeArea.height > layout.page.height ||
    !isInside(layout.gridBox, layout.page.safeArea)
  ) {
    throw new RangeError("Layout must provide a grid inside the page safe area.");
  }
};

const cellKey = (rowIndex: number, columnIndex: number): string => `${rowIndex}:${columnIndex}`;

const assertCellsAreUsable = (layout: MonthlyCalendarLayout): readonly LayoutCell[] => {
  const seen = new Set<string>();
  const cells: LayoutCell[] = [];

  for (const cell of layout.cells) {
    if (
      !Number.isInteger(cell?.rowIndex) ||
      !Number.isInteger(cell?.columnIndex) ||
      cell.rowIndex < 0 ||
      cell.rowIndex >= layout.rowCount ||
      cell.columnIndex < 0 ||
      cell.columnIndex >= layout.columnCount ||
      !isPhysicalBox(cell.box) ||
      !isInside(cell.box, layout.gridBox) ||
      !isInside(cell.box, layout.page.safeArea)
    ) {
      throw new RangeError("Layout cells must be positive boxes inside the grid safe area.");
    }

    const key = cellKey(cell.rowIndex, cell.columnIndex);
    if (seen.has(key)) {
      throw new RangeError("Layout cells must contain one box for each matrix coordinate.");
    }
    seen.add(key);
    cells.push(cell);
  }

  for (let rowIndex = 0; rowIndex < layout.rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < layout.columnCount; columnIndex += 1) {
      if (!seen.has(cellKey(rowIndex, columnIndex))) {
        throw new RangeError("Layout cells must contain one box for each matrix coordinate.");
      }
    }
  }

  for (let index = 0; index < cells.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < cells.length; otherIndex += 1) {
      if (intersects(cells[index].box, cells[otherIndex].box)) {
        throw new RangeError("Layout cells must not overlap.");
      }
    }
  }

  return cells;
};

const assertCalendarCell = (cell: MonthlyCalendarCell): void => {
  if (
    typeof cell?.isoDate !== "string" ||
    cell.isoDate === "" ||
    (cell.membership !== "current" && cell.membership !== "adjacent")
  ) {
    throw new RangeError("Calendar cells must identify a current or adjacent date.");
  }
};

const assertProtectedRegion = (
  protectedBox: PhysicalBox,
  annotation: CellAnnotationGeometry,
  cell: LayoutCell,
  layout: MonthlyCalendarLayout,
): void => {
  const annotationBoxes = [
    annotation.dayNumberBox,
    annotation.holidayLabelBox,
    annotation.gapBox,
  ];
  if (
    !hasPositiveArea(protectedBox) ||
    !isStrictlyInside(protectedBox, cell.box) ||
    !isInside(protectedBox, layout.page.safeArea) ||
    protectedBox.width < PROTECTED_WRITABLE_REGION_MINIMUMS_UM.width ||
    protectedBox.height < PROTECTED_WRITABLE_REGION_MINIMUMS_UM.height ||
    protectedBox.width * protectedBox.height < PROTECTED_WRITABLE_REGION_MINIMUMS_UM.area ||
    annotationBoxes.some((annotationBox) => intersects(protectedBox, annotationBox))
  ) {
    throw new RangeError("Layout cells are too small for the protected writable-region policy.");
  }
};

export const deriveWritableRegions = (
  layout: MonthlyCalendarLayout,
  calendar: MonthlyCalendar,
): WritableRegionLayout => {
  assertCalendarMatchesLayout(layout, calendar);
  assertPageAndGridGeometry(layout);
  const cells = assertCellsAreUsable(layout);
  const annotations: CellAnnotationGeometry[] = [];
  const protectedRegions: ProtectedWritableRegion[] = [];

  for (const cell of cells) {
    const dayNumberBox = boxAt(
      cell.box,
      WRITABLE_REGION_POLICY.dayNumber.top,
      WRITABLE_REGION_POLICY.dayNumber.bottom,
    );
    const holidayLabelBox = boxAt(
      cell.box,
      WRITABLE_REGION_POLICY.holidayLabel.top,
      WRITABLE_REGION_POLICY.holidayLabel.bottom,
    );
    const gapBox = boxAt(
      cell.box,
      WRITABLE_REGION_POLICY.annotationGap.top,
      WRITABLE_REGION_POLICY.annotationGap.bottom,
    );
    const protectedBox = boxAt(
      cell.box,
      WRITABLE_REGION_POLICY.protectedWritableRegion.top,
      cell.box.height - WRITABLE_REGION_POLICY.protectedWritableRegion.bottomInset,
    );
    const annotation = {
      rowIndex: cell.rowIndex,
      columnIndex: cell.columnIndex,
      dayNumberBox,
      holidayLabelBox,
      gapBox,
    };

    if (
      !annotationBoxesAreInsideCell(annotation, cell.box, layout.page.safeArea) ||
      intersects(dayNumberBox, holidayLabelBox) ||
      intersects(dayNumberBox, gapBox) ||
      intersects(holidayLabelBox, gapBox)
    ) {
      throw new RangeError("Layout cells are too small for the annotation allocation policy.");
    }

    assertProtectedRegion(protectedBox, annotation, cell, layout);
    annotations.push(annotation);

    const calendarCell = calendar.weeks[cell.rowIndex][cell.columnIndex];
    assertCalendarCell(calendarCell);
    if (calendarCell.membership === "current") {
      protectedRegions.push({
        rowIndex: cell.rowIndex,
        columnIndex: cell.columnIndex,
        isoDate: calendarCell.isoDate,
        box: protectedBox,
      });
    }
  }

  return {
    policyVersion: WRITABLE_REGION_POLICY_VERSION,
    annotations,
    protectedRegions,
  };
};

const annotationBoxesAreInsideCell = (
  annotation: CellAnnotationGeometry,
  cell: PhysicalBox,
  safeArea: PhysicalBox,
): boolean =>
  [annotation.dayNumberBox, annotation.holidayLabelBox, annotation.gapBox].every(
    (box) => hasPositiveArea(box) && isStrictlyInside(box, cell) && isInside(box, safeArea),
  );
