import {
  ADJACENT_DAY_NUMBER_STYLE_TOKEN,
  DEJAVU_SANS_FONT_TOKEN,
  validateLayoutDocument,
  type LayoutDocument,
  type LayoutShape,
  type LayoutText,
} from "./layout-ir.ts";
import type { PhysicalBox } from "../domain/layout-policy.ts";

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210000 297000">';
const SVG_STYLE = `text{font-family:"${DEJAVU_SANS_FONT_TOKEN}"}rect{fill:none;stroke:#000;stroke-width:300}`;
const SVG_CLOSE = "</svg>";
const NUMBER = "(0|[1-9]\\d*)";
const RECT = new RegExp(`^<rect x="${NUMBER}" y="${NUMBER}" width="${NUMBER}" height="${NUMBER}"\\/>`);
const TEXT = new RegExp(`^<text x="${NUMBER}" y="${NUMBER}" width="${NUMBER}" height="${NUMBER}" font-size="${NUMBER}" text-anchor="(start|middle)" dominant-baseline="(hanging|middle)"( fill="(#B8B8B8)")?>([^<]*)<\\/text>`);
// Bounded moon glyph grammar: an outlined or filled circle and a half-disc
// built from exactly one arc and one closing line segment. Half-disc path is
// "M cx-r cy A r r 0 0 sweep cx+r cy Z" (left half fills left→right edge),
// so the arc sweep flag is the only variable component.
const CIRCLE = new RegExp(`^<circle cx="${NUMBER}" cy="${NUMBER}" r="${NUMBER}"( fill="black")?\\/>`);
const HALF_DISC = new RegExp(`^<path d="M ${NUMBER} ${NUMBER} A ${NUMBER} ${NUMBER} 0 0 [01] ${NUMBER} ${NUMBER} Z" fill="black"\\/>`);

const fail: (message: string) => never = (message) => {
  throw new RangeError(`Restricted SVG ${message}.`);
};

const escapedText = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const numberFrom = (literal: string): number => {
  const value = Number(literal);
  if (!Number.isSafeInteger(value) || value < 0) fail("contains unsafe numeric geometry");
  return value;
};

const boxFrom = (match: RegExpMatchArray): PhysicalBox => ({
  x: numberFrom(match[1]),
  y: numberFrom(match[2]),
  width: numberFrom(match[3]),
  height: numberFrom(match[4]),
});

interface ParsedText {
  readonly box: PhysicalBox;
  readonly fontSizeUm: number;
  readonly fill: "#B8B8B8" | undefined;
  readonly textAnchor: "start" | "middle";
  readonly dominantBaseline: "hanging" | "middle";
}

const textFrom = (match: RegExpMatchArray): ParsedText => {
  const width = numberFrom(match[3]);
  const height = numberFrom(match[4]);
  const textAnchor = match[6] as ParsedText["textAnchor"];
  const dominantBaseline = match[7] as ParsedText["dominantBaseline"];
  const anchorX = numberFrom(match[1]);
  const anchorY = numberFrom(match[2]);

  return {
    box: {
      x: textAnchor === "middle" ? anchorX - Math.floor(width / 2) : anchorX,
      y: dominantBaseline === "middle" ? anchorY - Math.floor(height / 2) : anchorY,
      width,
      height,
    },
    fontSizeUm: numberFrom(match[5]),
    fill: match[9] as ParsedText["fill"],
    textAnchor,
    dominantBaseline,
  };
};

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

const assertPositiveBox = (box: PhysicalBox): void => {
  if (box.width === 0 || box.height === 0) fail("contains empty geometry");
};

const assertEscapedText = (value: string): void => {
  if (!/^(?:[^&<>]|&(amp|lt|gt|quot|apos);)*$/.test(value)) {
    fail("contains unescaped or unsupported text content");
  }
};

const boundaryAt = (origin: number, extent: number, index: number, divisions: number): number =>
  origin + Math.floor((extent * index) / divisions);

const expectedCellBox = (rowIndex: number, columnIndex: number, rowCount: number): PhysicalBox => ({
  x: boundaryAt(10_000, 190_000, columnIndex, 7),
  y: boundaryAt(23_000, 264_000, rowIndex, rowCount),
  width: boundaryAt(10_000, 190_000, columnIndex + 1, 7) - boundaryAt(10_000, 190_000, columnIndex, 7),
  height: boundaryAt(23_000, 264_000, rowIndex + 1, rowCount) - boundaryAt(23_000, 264_000, rowIndex, rowCount),
});

const serializeBox = (box: PhysicalBox): string =>
  `x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"`;

const isDayNumber = (element: LayoutText): boolean =>
  element.role === "day-number" || element.role === "adjacent-day-number";

const visualTextY = (element: LayoutText): number => {
  const boxY = element.dominantBaseline === "middle"
    ? element.box.y + Math.floor(element.box.height / 2)
    : element.box.y;

  // rsvg-convert places the visual glyph relative to the numeric y baseline.
  // Offset each hanging text role by its font size so both day numbers and
  // holiday labels render within their preallocated annotation boxes.
  return isDayNumber(element) || element.role === "holiday-label"
    ? boxY + element.fontSizeUm
    : boxY;
};

const serializeText = (element: LayoutText): string => {
  const x = element.textAnchor === "middle"
    ? element.box.x + Math.floor(element.box.width / 2)
    : element.box.x;
  const y = visualTextY(element);
  const fill = element.styleToken === ADJACENT_DAY_NUMBER_STYLE_TOKEN ? ' fill="#B8B8B8"' : "";
  return `<text x="${x}" y="${y}" width="${element.box.width}" height="${element.box.height}" font-size="${element.fontSizeUm}" text-anchor="${element.textAnchor}" dominant-baseline="${element.dominantBaseline}"${fill}>${escapedText(element.text)}</text>`;
};

/** Serializes only the approved visual projection of a canonical LayoutDocument. */
export const serializeRestrictedSvg = (document: LayoutDocument): string => {
  validateLayoutDocument(document);

  const content = document.elements.map((element) => {
    if (element.kind === "rectangle") return `<rect ${serializeBox(element.box)}/>`;
    if (element.kind === "shape") return serializeMoonMarker(element);
    return serializeText(element);
  }).join("");
  const svg = `${SVG_OPEN}<style>${SVG_STYLE}</style>${content}${SVG_CLOSE}`;
  validateRestrictedSvg(svg);
  return svg;
};

const MOON_MARKER_DIAMETER_UM = 3_000;
const MOON_MARKER_RADIUS_UM = MOON_MARKER_DIAMETER_UM / 2;

/**
 * Classic black-and-white phase glyph (southern-hemisphere convention:
 * first quarter fills the right half, last quarter fills the left half).
 * Serialization is fully derived from the canonical moon-marker element;
 * nothing free-form may reach the SVG body.
 */
const serializeMoonMarker = (element: LayoutShape): string => {
  const cx = element.box.x + MOON_MARKER_RADIUS_UM;
  const cy = element.box.y + MOON_MARKER_RADIUS_UM;
  if (element.shape === "circle") {
    const fill = element.phase === "full" ? ' fill="black"' : "";
    return `<circle cx="${cx}" cy="${cy}" r="${MOON_MARKER_RADIUS_UM}"${fill}/>`;
  }
  const side = element.fillSide === "left" ? 0 : 1;
  return `<path d="M ${cx - MOON_MARKER_RADIUS_UM} ${cy} A ${MOON_MARKER_RADIUS_UM} ${MOON_MARKER_RADIUS_UM} 0 0 ${side} ${cx + MOON_MARKER_RADIUS_UM} ${cy} Z" fill="black"/>`;
};

/** Validates the closed, metadata-free SVG transport grammar accepted by v1. */
export const validateRestrictedSvg: (value: unknown) => asserts value is string = (
  value,
) => {
  if (typeof value !== "string" || !value.startsWith(SVG_OPEN) || !value.endsWith(SVG_CLOSE)) {
    fail("must have the exact A4 SVG root");
  }

  let body = value.slice(SVG_OPEN.length, -SVG_CLOSE.length);
  const style = `<style>${SVG_STYLE}</style>`;
  if (!body.startsWith(style)) fail("must have one exact allowlisted style");
  body = body.slice(style.length);
  if (body.includes("<style")) fail("must have one exact allowlisted style");

  const rectangles: PhysicalBox[] = [];
  const texts: ParsedText[] = [];
  const shapes: ParsedShape[] = [];
  let sawText = false;
  while (body !== "") {
    const rectangle = body.match(RECT);
    if (rectangle) {
      if (sawText) fail("must keep rectangles before text in canonical order");
      const box = boxFrom(rectangle);
      assertPositiveBox(box);
      rectangles.push(box);
      body = body.slice(rectangle[0].length);
      continue;
    }

    const text = body.match(TEXT);
    if (text) {
      sawText = true;
      const parsed = textFrom(text);
      assertPositiveBox(parsed.box);
      if (parsed.fontSizeUm === 0) fail("contains an empty font size");
      assertEscapedText(text[10]);
      texts.push(parsed);
      body = body.slice(text[0].length);
      continue;
    }

    const circle = body.match(CIRCLE);
    if (circle) {
      const cx = numberFrom(circle[1]);
      const cy = numberFrom(circle[2]);
      const radius = numberFrom(circle[3]);
      if (radius !== MOON_MARKER_RADIUS_UM) fail("contains a moon marker with an unapproved radius");
      shapes.push({ kind: "circle", cx, cy, radius });
      body = body.slice(circle[0].length);
      continue;
    }

    const halfDisc = body.match(HALF_DISC);
    if (halfDisc) {
      const x1 = numberFrom(halfDisc[1]);
      const y1 = numberFrom(halfDisc[2]);
      const radius = numberFrom(halfDisc[3]);
      const x2 = numberFrom(halfDisc[5]);
      const y2 = numberFrom(halfDisc[6]);
      if (radius !== MOON_MARKER_RADIUS_UM) fail("contains a moon marker with an unapproved radius");
      if (y1 !== y2 || Math.abs(x2 - x1) !== 2 * MOON_MARKER_RADIUS_UM) {
        fail("contains a moon marker half-disc with unapproved geometry");
      }
      shapes.push({ kind: "half-disc", cx: (x1 + x2) / 2, cy: y1, radius });
      body = body.slice(halfDisc[0].length);
      continue;
    }

    fail("contains an unapproved element, attribute, or syntax");
  }

  const rowCount = rectangles.length === 37 ? 5 : rectangles.length === 44 ? 6 : undefined;
  if (!rowCount) fail("must contain the canonical page, grid, and cell rectangles");
  if (!sameBox(rectangles[0], { x: 0, y: 0, width: 210_000, height: 297_000 })) {
    fail("must start with the canonical A4 page rectangle");
  }
  if (!sameBox(rectangles[1], { x: 10_000, y: 23_000, width: 190_000, height: 264_000 })) {
    fail("must place the grid after the page rectangle");
  }
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < 7; columnIndex += 1) {
      const index = 2 + rowIndex * 7 + columnIndex;
      if (!sameBox(rectangles[index], expectedCellBox(rowIndex, columnIndex, rowCount))) {
        fail("must keep cells in canonical matrix order");
      }
    }
  }

  const heading = { x: 10_000, y: 10_000, width: 190_000, height: 8_000 };
  if (
    texts.length < 8 + rowCount * 7 ||
    !sameBox(texts[0].box, heading) ||
    texts[0].textAnchor !== "middle" ||
    texts[0].dominantBaseline !== "middle"
  ) {
    fail("must start text with the centered canonical heading");
  }
  for (let columnIndex = 0; columnIndex < 7; columnIndex += 1) {
    const weekday = {
      x: boundaryAt(10_000, 190_000, columnIndex, 7),
      y: 18_000,
      width: boundaryAt(10_000, 190_000, columnIndex + 1, 7) - boundaryAt(10_000, 190_000, columnIndex, 7),
      height: 5_000,
    };
    const text = texts[1 + columnIndex];
    if (!sameBox(text.box, weekday) || text.textAnchor !== "middle" || text.dominantBaseline !== "middle") {
      fail("must keep centered weekday text in canonical order");
    }
  }

  let textIndex = 8;
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < 7; columnIndex += 1) {
      const cell = expectedCellBox(rowIndex, columnIndex, rowCount);
      const day = texts[textIndex];
      if (
        !day ||
        !isInside(day.box, cell) ||
        day.box.y <= cell.y ||
        day.textAnchor !== "start" ||
        day.dominantBaseline !== "hanging"
      ) {
        fail("must keep padded day text inside its canonical cell");
      }
      textIndex += 1;
      let holidayLineCount = 0;
      while (holidayLineCount < 2 && texts[textIndex] && isInside(texts[textIndex].box, cell)) {
        const holiday = texts[textIndex];
        if (holiday.textAnchor !== "start" || holiday.dominantBaseline !== "hanging") {
          fail("must keep holiday text left-aligned in its annotation box");
        }
        textIndex += 1;
        holidayLineCount += 1;
      }
      if (texts[textIndex] && isInside(texts[textIndex].box, cell)) {
        fail("must keep no more than two holiday text lines in canonical matrix order");
      }
    }
  }
  if (textIndex !== texts.length) fail("must keep day and holiday text in canonical matrix order");

  // Moon markers: every parsed shape must sit inside one canonical cell and
  // vertically within its day-number band (the protected handwriting region
  // starts at 15.5 mm from the cell top; the band ends at 6 mm).
  for (const shape of shapes) {
    const box = {
      x: shape.cx - shape.radius,
      y: shape.cy - shape.radius,
      width: 2 * shape.radius,
      height: 2 * shape.radius,
    };
    const inCell = rectangles.slice(2).some((cellBox) =>
      box.x >= cellBox.x &&
      box.y >= cellBox.y &&
      box.x + box.width <= cellBox.x + cellBox.width &&
      box.y + box.height <= cellBox.y + cellBox.height,
    );
    if (!inCell) fail("must keep moon markers inside a canonical cell");
    const inDayBand = rectangles.slice(2).some((cellBox) => {
      const bandTop = cellBox.y + 1_500;
      const bandBottom = cellBox.y + 6_000;
      return box.y >= bandTop && box.y + box.height <= bandBottom;
    });
    if (!inDayBand) fail("must keep moon markers inside the day-number annotation band");
  }
};

interface ParsedShape {
  readonly kind: "circle" | "half-disc";
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
}
