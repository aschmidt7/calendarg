import type { MonthlyCalendar } from "./month.ts";

export type Micrometres = number;

export interface PhysicalBox {
  readonly x: Micrometres;
  readonly y: Micrometres;
  readonly width: Micrometres;
  readonly height: Micrometres;
}

export interface PageGeometry {
  readonly width: Micrometres;
  readonly height: Micrometres;
}

export interface LayoutPolicy {
  readonly page: PageGeometry;
  readonly safeArea: PhysicalBox;
  readonly headingBandHeight: Micrometres;
  readonly weekdayBandHeight: Micrometres;
  readonly gridHeight: Micrometres;
  readonly columnCount: 7;
  readonly minimumRowCount: 5;
  readonly maximumRowCount: 6;
}

export interface LayoutCell {
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly box: PhysicalBox;
}

export interface MonthlyCalendarLayout {
  readonly page: PageGeometry & { readonly safeArea: PhysicalBox };
  readonly headingBox: PhysicalBox;
  readonly weekdayBoxes: readonly PhysicalBox[];
  readonly gridBox: PhysicalBox;
  readonly rowCount: number;
  readonly columnCount: 7;
  readonly cells: readonly LayoutCell[];
}

export const A4_PAGE_UM: PageGeometry = {
  width: 210_000,
  height: 297_000,
};

export const PROPOSED_COMPACT_HEADER_A4_POLICY: LayoutPolicy = {
  page: A4_PAGE_UM,
  safeArea: {
    x: 10_000,
    y: 10_000,
    width: 190_000,
    height: 277_000,
  },
  headingBandHeight: 8_000,
  weekdayBandHeight: 5_000,
  gridHeight: 264_000,
  columnCount: 7,
  minimumRowCount: 5,
  maximumRowCount: 6,
};

const isNonNegativeInteger = (value: unknown): value is Micrometres =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPositiveInteger = (value: unknown): value is Micrometres =>
  isNonNegativeInteger(value) && value > 0;

const assertPolicy = (policy: LayoutPolicy): void => {
  const { page, safeArea } = policy;
  if (
    !isPositiveInteger(page?.width) ||
    !isPositiveInteger(page?.height) ||
    !isNonNegativeInteger(safeArea?.x) ||
    !isNonNegativeInteger(safeArea?.y) ||
    !isPositiveInteger(safeArea?.width) ||
    !isPositiveInteger(safeArea?.height) ||
    !isPositiveInteger(policy.headingBandHeight) ||
    !isPositiveInteger(policy.weekdayBandHeight) ||
    !isPositiveInteger(policy.gridHeight) ||
    policy.columnCount !== 7 ||
    policy.minimumRowCount !== 5 ||
    policy.maximumRowCount !== 6
  ) {
    throw new RangeError("Layout policy must contain valid fixed-point geometry.");
  }

  if (
    page.width !== A4_PAGE_UM.width ||
    page.height !== A4_PAGE_UM.height ||
    safeArea.x !== 10_000 ||
    safeArea.y !== 10_000 ||
    safeArea.width !== 190_000 ||
    safeArea.height !== 277_000 ||
    policy.headingBandHeight !== 8_000 ||
    policy.weekdayBandHeight !== 5_000 ||
    policy.gridHeight !== 264_000 ||
    safeArea.x + safeArea.width > page.width ||
    safeArea.y + safeArea.height > page.height ||
    policy.headingBandHeight + policy.weekdayBandHeight + policy.gridHeight !== safeArea.height
  ) {
    throw new RangeError("Layout policy does not preserve the experimental compact-header A4 safe geometry.");
  }
};

const assertCalendarMatrix = (calendar: MonthlyCalendar): asserts calendar is MonthlyCalendar => {
  if (!Array.isArray(calendar?.weeks) || (calendar.weeks.length !== 5 && calendar.weeks.length !== 6)) {
    throw new RangeError("Monthly calendar must contain five or six weeks.");
  }

  for (const week of calendar.weeks) {
    if (!Array.isArray(week) || week.length !== 7) {
      throw new RangeError("Each monthly calendar week must contain exactly seven cells.");
    }
  }
};

const boundaryAt = (
  origin: Micrometres,
  extent: Micrometres,
  index: number,
  divisions: number,
): Micrometres => origin + Math.floor((extent * index) / divisions);

const boxBetween = (
  left: Micrometres,
  top: Micrometres,
  right: Micrometres,
  bottom: Micrometres,
): PhysicalBox => ({
  x: left,
  y: top,
  width: right - left,
  height: bottom - top,
});

export const deriveMonthlyCalendarLayout = (
  calendar: MonthlyCalendar,
  policy: LayoutPolicy,
): MonthlyCalendarLayout => {
  assertPolicy(policy);
  assertCalendarMatrix(calendar);

  const { safeArea } = policy;
  const headingBox = boxBetween(
    safeArea.x,
    safeArea.y,
    safeArea.x + safeArea.width,
    safeArea.y + policy.headingBandHeight,
  );
  const weekdayTop = headingBox.y + headingBox.height;
  const weekdayBottom = weekdayTop + policy.weekdayBandHeight;
  const gridBox = boxBetween(
    safeArea.x,
    weekdayBottom,
    safeArea.x + safeArea.width,
    weekdayBottom + policy.gridHeight,
  );
  const weekdayBoxes = Array.from({ length: policy.columnCount }, (_, columnIndex) =>
    boxBetween(
      boundaryAt(safeArea.x, safeArea.width, columnIndex, policy.columnCount),
      weekdayTop,
      boundaryAt(safeArea.x, safeArea.width, columnIndex + 1, policy.columnCount),
      weekdayBottom,
    ),
  );
  const rowCount = calendar.weeks.length;
  const cells = calendar.weeks.flatMap((week, rowIndex) =>
    week.map((_calendarCell, columnIndex) =>
      ({
        rowIndex,
        columnIndex,
        box: boxBetween(
          boundaryAt(gridBox.x, gridBox.width, columnIndex, policy.columnCount),
          boundaryAt(gridBox.y, gridBox.height, rowIndex, rowCount),
          boundaryAt(gridBox.x, gridBox.width, columnIndex + 1, policy.columnCount),
          boundaryAt(gridBox.y, gridBox.height, rowIndex + 1, rowCount),
        ),
      }),
    ),
  );

  return {
    page: { ...policy.page, safeArea },
    headingBox,
    weekdayBoxes,
    gridBox,
    rowCount,
    columnCount: policy.columnCount,
    cells,
  };
};
