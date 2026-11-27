import assert from "node:assert/strict";
import test from "node:test";

import { buildLayoutDocument, type LayoutDocument, type LayoutText } from "../src/rendering/layout-ir.ts";
import { DETERMINISTIC_HOLIDAY_TEXT_METRICS } from "../src/rendering/holiday-fitting.ts";
import {
  deriveMonthlyCalendarLayout,
  PROPOSED_COMPACT_HEADER_A4_POLICY,
} from "../src/domain/layout-policy.ts";
import { buildMonthlyCalendar } from "../src/domain/month.ts";
import { serializeRestrictedSvg, validateRestrictedSvg } from "../src/rendering/svg.ts";
import { deriveWritableRegions } from "../src/domain/writable-regions.ts";
import type { HolidayResolution } from "../src/application/holiday-resolver.ts";
import type { HolidayCoverage } from "../src/domain/holidays.ts";

const verifiedCoverage = (
  year: number,
  holidays: HolidayCoverage["holidays"],
): HolidayResolution => ({
  verification: "verified",
  coverage: {
    year,
    scope: "argentina-national",
    status: "valid",
    coveredFrom: `${year.toString().padStart(4, "0")}-01-01`,
    coveredThrough: `${year.toString().padStart(4, "0")}-12-31`,
    provenance: {
      source: "fixture",
      retrievedOn: `${year.toString().padStart(4, "0")}-01-01`,
      validThrough: `${year.toString().padStart(4, "0")}-12-31`,
    },
    holidays,
  },
  diagnostics: [],
});

const buildDocument = (label = "Workers' Day"): LayoutDocument => {
  const calendar = buildMonthlyCalendar(
    { year: 2024, month: 5 },
    verifiedCoverage(2024, [{
      date: "2024-05-01",
      label,
      classification: "inamovible",
    }]),
  );
  const layout = deriveMonthlyCalendarLayout(calendar, PROPOSED_COMPACT_HEADER_A4_POLICY);
  return buildLayoutDocument(calendar, layout, deriveWritableRegions(layout, calendar));
};

const escapedDocument = (): LayoutDocument => {
  const document = structuredClone(buildDocument()) as LayoutDocument;
  const heading = document.elements.find((element) => element.role === "heading");
  const holiday = document.elements.find((element) => element.role === "holiday-label");
  if (!heading || !holiday || heading.kind !== "text" || holiday.kind !== "text") {
    throw new Error("Expected heading and holiday text fixtures.");
  }
  (heading as { text: string }).text = `May & <June> \"'`;
  (holiday as { text: string }).text = `Holiday & <safe>`;
  return document;
};

test("serializes a validated canonical document as one A4 restricted SVG", () => {
  const document = buildDocument();
  const svg = serializeRestrictedSvg(document);

  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="210mm" height="297mm" viewBox="0 0 210000 297000"><style>/);
  assert.match(svg, /dejavu-sans@1\.0\.0/);
  assert.doesNotMatch(svg, /<style>[^<]*font-size\s*:/);
  assert.match(svg, /<text x="105000" y="14000" width="190000" height="8000" font-size="5000" text-anchor="middle" dominant-baseline="middle">/);
  const weekdayHeaders = document.elements.filter((element) => element.role === "weekday-header");
  assert.equal(weekdayHeaders.length, 7);
  for (const weekdayHeader of weekdayHeaders) {
    if (weekdayHeader.kind !== "text") throw new Error("Weekday header fixture must be text.");
    assert.match(svg, new RegExp(
      `<text x="${weekdayHeader.box.x + Math.floor(weekdayHeader.box.width / 2)}" y="${weekdayHeader.box.y + Math.floor(weekdayHeader.box.height / 2)}" width="${weekdayHeader.box.width}" height="${weekdayHeader.box.height}" font-size="3000" text-anchor="middle" dominant-baseline="middle">${weekdayHeader.text}</text>`,
    ));
  }
  assert.match(svg, /<text x="11500" y="28700" width="24142" height="4500" font-size="4200" text-anchor="start" dominant-baseline="hanging" fill="#B8B8B8">/);
  const dayNumbers = document.elements.filter((element): element is LayoutText =>
    element.kind === "text" && (element.role === "day-number" || element.role === "adjacent-day-number"),
  );
  assert.ok(dayNumbers.some((element) => element.role === "day-number"));
  assert.ok(dayNumbers.some((element) => element.role === "adjacent-day-number"));
  for (const dayNumber of dayNumbers) {
    const fill = dayNumber.role === "adjacent-day-number" ? ' fill="#B8B8B8"' : "";
    assert.match(svg, new RegExp(
      `<text x="${dayNumber.box.x}" y="${dayNumber.box.y + dayNumber.fontSizeUm}" width="${dayNumber.box.width}" height="${dayNumber.box.height}" font-size="${dayNumber.fontSizeUm}" text-anchor="start" dominant-baseline="hanging"${fill}>`,
    ));
  }
  assert.equal((svg.match(/<style>/g) ?? []).length, 1);
  assert.equal((svg.match(/<rect\b/g) ?? []).length, 37);
  assert.ok((svg.match(/<text\b/g) ?? []).length > 0);
  assert.doesNotThrow(() => validateRestrictedSvg(svg));
});

test("serializes only adjacent-month day numbers with the approved secondary gray", () => {
  const document = buildDocument();
  const svg = serializeRestrictedSvg(document);
  const adjacentDay = document.elements.find((element) => element.role === "adjacent-day-number");
  const currentDay = document.elements.find((element) => element.role === "day-number");

  if (!adjacentDay || adjacentDay.kind !== "text" || !currentDay || currentDay.kind !== "text") {
    throw new Error("Expected adjacent and current day text fixtures.");
  }
  assert.match(svg, new RegExp(
    `<text x="${adjacentDay.box.x}" y="${adjacentDay.box.y + adjacentDay.fontSizeUm}" width="${adjacentDay.box.width}" height="${adjacentDay.box.height}" font-size="${adjacentDay.fontSizeUm}" text-anchor="start" dominant-baseline="hanging" fill="#B8B8B8">${adjacentDay.text}</text>`,
  ));
  assert.match(svg, new RegExp(
    `<text x="${currentDay.box.x}" y="${currentDay.box.y + currentDay.fontSizeUm}" width="${currentDay.box.width}" height="${currentDay.box.height}" font-size="${currentDay.fontSizeUm}" text-anchor="start" dominant-baseline="hanging">${currentDay.text}</text>`,
  ));
  assert.equal((svg.match(/fill="#B8B8B8"/g) ?? []).length, document.elements.filter((element) => element.role === "adjacent-day-number").length);
  assert.throws(() => validateRestrictedSvg(svg.replace('fill="#B8B8B8"', 'fill="#FF0000"')), /unapproved/i);
});

test("serializes fitted long holiday lines at their selected size without audit metadata", () => {
  const originalLabel = "National Commemoration of an Exceptionally Long Historic and Cultural Anniversary";
  const document = buildDocument(originalLabel);
  const holidayLines = document.elements.filter((element) =>
    element.role === "holiday-label" && element.rowIndex === 0 && element.columnIndex === 2,
  );
  const svg = serializeRestrictedSvg(document);

  assert.ok(holidayLines.length >= 1 && holidayLines.length <= 2);
  for (const line of holidayLines) {
    if (line.kind !== "text") throw new Error("Holiday label fixture must be text.");
    assert.match(svg, new RegExp(`<text x="${line.box.x}" y="${line.box.y + line.fontSizeUm}" width="${line.box.width}" height="${line.box.height}" font-size="${line.fontSizeUm}" text-anchor="start" dominant-baseline="hanging">`));
    assert.ok(
      DETERMINISTIC_HOLIDAY_TEXT_METRICS.measureWidth(line.text, line.fontSizeUm) <= line.box.width,
    );
  }
  assert.ok(holidayLines.some((line) => line.kind === "text" && line.text.includes("…")));
  assert.doesNotMatch(svg, new RegExp(originalLabel));
  assert.doesNotMatch(svg, /originalLabel|holiday-label-truncated|diagnostics/);
  assert.doesNotMatch(svg, /font-size="4200">(?:National|Commemoration)/);
  assert.doesNotThrow(() => validateRestrictedSvg(svg));
});

test("serializes Día del Trabajador at its fitted node size without a global override", () => {
  const document = buildDocument("Día del Trabajador");
  const holidayLines = document.elements.filter((element) => element.role === "holiday-label");
  const svg = serializeRestrictedSvg(document);

  assert.ok(holidayLines.length >= 1 && holidayLines.length <= 2);
  assert.match(svg, /Día del Trabajador/);
  assert.doesNotMatch(svg, /<style>[^<]*font-size\s*:/);
  for (const line of holidayLines) {
    if (line.kind !== "text") throw new Error("Holiday label fixture must be text.");
    assert.match(svg, new RegExp(
      `<text x="${line.box.x}" y="${line.box.y + line.fontSizeUm}" width="${line.box.width}" height="${line.box.height}" font-size="${line.fontSizeUm}" text-anchor="start" dominant-baseline="hanging">`,
    ));
  }
  assert.doesNotThrow(() => validateRestrictedSvg(svg));
});

test("escapes canonical heading, weekday, day, and holiday text content", () => {
  const svg = serializeRestrictedSvg(escapedDocument());

  assert.match(svg, /May &amp; &lt;June&gt; &quot;&apos;<\/text>/);
  assert.match(svg, /Holiday &amp; &lt;safe&gt;<\/text>/);
  assert.doesNotThrow(() => validateRestrictedSvg(svg));
});

test("rejects forbidden features, metadata, unsafe geometry, and non-canonical element order", () => {
  const svg = serializeRestrictedSvg(buildDocument());
  const firstRect = svg.match(/<rect\b[^>]*\/>/);
  const secondRect = svg.slice((firstRect?.index ?? 0) + (firstRect?.[0].length ?? 0)).match(/<rect\b[^>]*\/>/);
  if (!firstRect || !secondRect || firstRect.index === undefined || secondRect.index === undefined) {
    throw new Error("Expected canonical rectangle fixture.");
  }
  const secondIndex = (firstRect.index + firstRect[0].length) + secondRect.index;
  const swapped = `${svg.slice(0, firstRect.index)}${secondRect[0]}${firstRect[0]}${svg.slice(secondIndex + secondRect[0].length)}`;

  for (const invalid of [
    svg.replace("</svg>", "<script>bad()</script></svg>"),
    svg.replace("<rect ", "<rect onclick=\"bad()\" "),
    svg.replace("</style>", "rect{fill:url(https://example.invalid/x)}</style>"),
    svg.replace("<svg ", "<svg data-protected-region=\"leak\" "),
    svg.replace('width="210000"', 'width="-1"'),
    swapped,
  ]) {
    assert.throws(() => validateRestrictedSvg(invalid));
  }
});

test("serializes moon markers as bounded circles and half-discs", async () => {
  const { deriveMoonPhasesForMonth } = await import("../src/domain/moon.ts");
  const calendar = buildMonthlyCalendar(
    { year: 2024, month: 5 },
    undefined,
    deriveMoonPhasesForMonth({ year: 2024, month: 5 }),
  );
  const layout = deriveMonthlyCalendarLayout(calendar, PROPOSED_COMPACT_HEADER_A4_POLICY);
  const document = buildLayoutDocument(calendar, layout, deriveWritableRegions(layout, calendar));
  const svg = serializeRestrictedSvg(document);
  const circles = svg.match(/<circle cx="\d+" cy="\d+" r="1500"( fill="black"| fill="none" stroke="black" stroke-width="300")?\/>/g) ?? [];
  const halfDiscs = svg.match(/<path d="M \d+ \d+ A 1500 1500 0 0 [01] \d+ \d+ Z" fill="black"\/>/g) ?? [];
  assert.equal(circles.length, 2); // new + full
  assert.equal(halfDiscs.length, 3); // LQ, FQ, LQ
  assert.ok(circles.some((circle) => circle.endsWith('fill="black"/>'))); // full moon is solid
  assert.ok(circles.some((circle) => circle.includes('fill="none" stroke="black"'))); // new moon is an outlined empty disc
});

test("half-disc orientation: first quarter fills left, last quarter fills right (southern hemisphere)", async () => {
  const { deriveMoonPhasesForMonth } = await import("../src/domain/moon.ts");
  const calendar = buildMonthlyCalendar(
    { year: 2024, month: 5 },
    undefined,
    deriveMoonPhasesForMonth({ year: 2024, month: 5 }),
  );
  const layout = deriveMonthlyCalendarLayout(calendar, PROPOSED_COMPACT_HEADER_A4_POLICY);
  const document = buildLayoutDocument(calendar, layout, deriveWritableRegions(layout, calendar));
  const svg = serializeRestrictedSvg(document);
  // Chord is the vertical diameter: x1 == x2 and y2 == y1 + 2*r.
  const halfDiscs = [...svg.matchAll(/<path d="M (\d+) (\d+) A 1500 1500 0 0 ([01]) (\d+) (\d+) Z" fill="black"\/>/g)];
  assert.ok(halfDiscs.length > 0);
  for (const match of halfDiscs) {
    const [, x1, y1, sweep, x2, y2] = match;
    assert.equal(x1, x2, "half-disc chord must be vertical");
    assert.equal(Number(y2) - Number(y1), 3000, "half-disc chord must span the vertical diameter");
    assert.ok(match[0]);
  }
  // First quarter: sweep 0 (from the top point the counterclockwise arc
  // passes the leftmost point) => filled left half — the southern-hemisphere
  // view where the waxing moon is lit on the left (verified against the
  // official SHN phase icons, LUNA2.jpg). Last quarter: sweep 1 => right half.
  const sweeps = halfDiscs.map((match) => match[3]);
  assert.ok(sweeps.includes("0"), "first-quarter marker must fill the left half");
  assert.ok(sweeps.includes("1"), "last-quarter marker must fill the right half");
});
test("rejects arbitrary path data and wrong moon-marker geometry", async () => {
  const { deriveMoonPhasesForMonth } = await import("../src/domain/moon.ts");
  const calendar = buildMonthlyCalendar(
    { year: 2024, month: 5 },
    undefined,
    deriveMoonPhasesForMonth({ year: 2024, month: 5 }),
  );
  const layout = deriveMonthlyCalendarLayout(calendar, PROPOSED_COMPACT_HEADER_A4_POLICY);
  const document = buildLayoutDocument(calendar, layout, deriveWritableRegions(layout, calendar));
  const svg = serializeRestrictedSvg(document);
  assert.throws(() => validateRestrictedSvg(svg.replace(/r="1500"/, 'r="1600"')), /unapproved radius/);
  const freeform = svg.replace(
    /<path d="[^"]*" fill="black"\/>/,
    '<path d="M 100 100 C 100 100 100 100 100 100 Z" fill="black"/>',
  );
  assert.throws(() => validateRestrictedSvg(freeform), /unapproved element|unapproved geometry/);
});
