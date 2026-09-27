import {
  ADJACENT_DAY_NUMBER_STYLE_TOKEN,
  DEJAVU_SANS_FONT_TOKEN,
  validateLayoutDocument,
  type LayoutDocument,
  type LayoutText,
} from "./layout-ir.ts";
import type { PhysicalBox } from "../domain/layout-policy.ts";

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210000 297000">';
const SVG_STYLE = `text{font-family:"${DEJAVU_SANS_FONT_TOKEN}"}rect{fill:none;stroke:#000;stroke-width:300}`;
const SVG_CLOSE = "</svg>";
const NUMBER = "(0|[1-9]\\d*)";
const RECT = new RegExp(`^<rect x="${NUMBER}" y="${NUMBER}" width="${NUMBER}" height="${NUMBER}"\\/>`);
const TEXT = new RegExp(`^<text x="${NUMBER}" y="${NUMBER}" width="${NUMBER}" height="${NUMBER}" font-size="${NUMBER}" text-anchor="(start|middle)" dominant-baseline="(hanging|middle)"( fill="(#B8B8B8)")?>([^<]*)<\\/text>`);

const fail = (message: string): never => {
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
    return serializeText(element);
  }).join("");
  const svg = `${SVG_OPEN}<style>${SVG_STYLE}</style>${content}${SVG_CLOSE}`;
  validateRestrictedSvg(svg);
  return svg;
};

/** Validates the closed, metadata-free SVG transport grammar accepted by v1. */
export const validateRestrictedSvg = (value: unknown): asserts value is string => {
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
};
