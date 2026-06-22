import type { ParsedKline } from "./types";

export type ChanFractalKind = "top" | "bottom";
export type ChanStrokeDirection = "up" | "down";
export type ChanTrend = ChanStrokeDirection | "neutral";
export type ChanPricePosition = "below_pivot" | "inside_pivot" | "above_pivot" | "no_pivot";
export type ChanDivergence = "bullish" | "bearish" | "none";
export type ChanSetup =
  | "insufficient_structure"
  | "center_chop"
  | "buy_divergence"
  | "sell_divergence"
  | "third_buy_candidate"
  | "third_sell_candidate"
  | "trend_follow";

export interface ChanFractal {
  kind: ChanFractalKind;
  index: number;
  openTime: number;
  price: number;
}

export interface ChanStroke {
  direction: ChanStrokeDirection;
  start: ChanFractal;
  end: ChanFractal;
  high: number;
  low: number;
  bars: number;
  strengthPctPerBar: number;
}

export interface ChanPivotZone {
  low: number;
  high: number;
  startOpenTime: number;
  endOpenTime: number;
  strokeCount: number;
}

export interface ChanStructure {
  trend: ChanTrend;
  fractals: ChanFractal[];
  strokes: ChanStroke[];
  pivotZone?: ChanPivotZone;
  pricePosition: ChanPricePosition;
  divergence: ChanDivergence;
  setup: ChanSetup;
}

export interface ChanStructureOptions {
  includeLast?: boolean;
  minFractalGap?: number;
}

function isContained(a: ParsedKline, b: ParsedKline): boolean {
  return (b.high <= a.high && b.low >= a.low) || (b.high >= a.high && b.low <= a.low);
}

function mergeContained(last: ParsedKline, current: ParsedKline, direction: ChanTrend): ParsedKline {
  const up = direction !== "down";
  return {
    ...last,
    high: up ? Math.max(last.high, current.high) : Math.min(last.high, current.high),
    low: up ? Math.max(last.low, current.low) : Math.min(last.low, current.low),
    close: current.close,
    volume: last.volume + current.volume,
    quoteVolume: last.quoteVolume + current.quoteVolume
  };
}

function currentMergeDirection(rows: ParsedKline[]): ChanTrend {
  if (rows.length < 2) {
    return "up";
  }
  return rows.at(-1)!.close >= rows.at(-2)!.close ? "up" : "down";
}

export function normalizeChanRows(rows: ParsedKline[]): ParsedKline[] {
  const normalized: ParsedKline[] = [];
  for (const row of rows) {
    const last = normalized.at(-1);
    if (last && isContained(last, row)) {
      normalized[normalized.length - 1] = mergeContained(last, row, currentMergeDirection(normalized));
    } else {
      normalized.push({ ...row });
    }
  }
  return normalized;
}

function buildFractals(rows: ParsedKline[]): ChanFractal[] {
  const fractals: ChanFractal[] = [];
  for (let index = 1; index < rows.length - 1; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    const next = rows[index + 1];
    if (current.high > previous.high && current.high > next.high) {
      fractals.push({ kind: "top", index, openTime: current.openTime, price: current.high });
    } else if (current.low < previous.low && current.low < next.low) {
      fractals.push({ kind: "bottom", index, openTime: current.openTime, price: current.low });
    }
  }
  return fractals;
}

function isMoreExtreme(candidate: ChanFractal, existing: ChanFractal): boolean {
  return candidate.kind === "top" ? candidate.price >= existing.price : candidate.price <= existing.price;
}

function selectFractals(fractals: ChanFractal[], minGap: number): ChanFractal[] {
  const selected: ChanFractal[] = [];
  for (const fractal of fractals) {
    const last = selected.at(-1);
    if (!last) {
      selected.push(fractal);
      continue;
    }
    if (fractal.kind === last.kind) {
      if (isMoreExtreme(fractal, last)) {
        selected[selected.length - 1] = fractal;
      }
      continue;
    }
    if (fractal.index - last.index < minGap) {
      continue;
    }
    selected.push(fractal);
  }
  return selected;
}

function buildStrokes(fractals: ChanFractal[]): ChanStroke[] {
  const strokes: ChanStroke[] = [];
  for (let index = 1; index < fractals.length; index += 1) {
    const start = fractals[index - 1];
    const end = fractals[index];
    if (start.kind === end.kind) {
      continue;
    }
    const direction: ChanStrokeDirection = start.kind === "bottom" && end.kind === "top" ? "up" : "down";
    const high = Math.max(start.price, end.price);
    const low = Math.min(start.price, end.price);
    const bars = Math.max(1, end.index - start.index);
    const base = start.price > 0 ? start.price : end.price;
    strokes.push({
      direction,
      start,
      end,
      high,
      low,
      bars,
      strengthPctPerBar: base > 0 ? (Math.abs(end.price - start.price) / base) * 100 / bars : 0
    });
  }
  return strokes;
}

function latestPivotZone(strokes: ChanStroke[]): ChanPivotZone | undefined {
  for (let end = strokes.length; end >= 3; end -= 1) {
    const window = strokes.slice(end - 3, end);
    const low = Math.max(...window.map((stroke) => stroke.low));
    const high = Math.min(...window.map((stroke) => stroke.high));
    if (low <= high) {
      return {
        low,
        high,
        startOpenTime: window[0].start.openTime,
        endOpenTime: window[2].end.openTime,
        strokeCount: window.length
      };
    }
  }
  return undefined;
}

function classifyPosition(price: number, pivotZone?: ChanPivotZone): ChanPricePosition {
  if (!pivotZone) {
    return "no_pivot";
  }
  if (price < pivotZone.low) {
    return "below_pivot";
  }
  if (price > pivotZone.high) {
    return "above_pivot";
  }
  return "inside_pivot";
}

function detectDivergence(strokes: ChanStroke[]): ChanDivergence {
  const latest = strokes.at(-1);
  if (!latest) {
    return "none";
  }
  const previousSame = strokes.slice(0, -1).reverse().find((stroke) => stroke.direction === latest.direction);
  if (!previousSame) {
    return "none";
  }
  if (
    latest.direction === "down" &&
    latest.end.price < previousSame.end.price &&
    latest.strengthPctPerBar < previousSame.strengthPctPerBar
  ) {
    return "bullish";
  }
  if (
    latest.direction === "up" &&
    latest.end.price > previousSame.end.price &&
    latest.strengthPctPerBar < previousSame.strengthPctPerBar
  ) {
    return "bearish";
  }
  return "none";
}

function classifySetup(trend: ChanTrend, pricePosition: ChanPricePosition, divergence: ChanDivergence, strokes: ChanStroke[]): ChanSetup {
  if (strokes.length < 3) {
    return "insufficient_structure";
  }
  if (divergence === "bullish") {
    return "buy_divergence";
  }
  if (divergence === "bearish") {
    return "sell_divergence";
  }
  if (pricePosition === "inside_pivot") {
    return "center_chop";
  }
  if (trend === "up" && pricePosition === "above_pivot") {
    return "third_buy_candidate";
  }
  if (trend === "down" && pricePosition === "below_pivot") {
    return "third_sell_candidate";
  }
  return "trend_follow";
}

export function analyzeChanStructure(rows: ParsedKline[], options: ChanStructureOptions = {}): ChanStructure {
  const now = Date.now();
  const sourceRows = options.includeLast ? rows : rows.filter((row) => row.closeTime === undefined || row.closeTime <= now);
  const normalizedRows = normalizeChanRows(sourceRows.filter((row) => row.high > 0 && row.low > 0 && row.high >= row.low));
  const fractals = selectFractals(buildFractals(normalizedRows), options.minFractalGap ?? 2);
  const strokes = buildStrokes(fractals);
  const latestStroke = strokes.at(-1);
  const trend = latestStroke?.direction ?? "neutral";
  const pivotZone = latestPivotZone(strokes);
  const price = normalizedRows.at(-1)?.close ?? 0;
  const pricePosition = classifyPosition(price, pivotZone);
  const divergence = detectDivergence(strokes);
  const setup = classifySetup(trend, pricePosition, divergence, strokes);

  return { trend, fractals, strokes, pivotZone, pricePosition, divergence, setup };
}

export function formatChanStructureLabel(structure: ChanStructure): string {
  const pivot = structure.pivotZone
    ? `${structure.pivotZone.low.toFixed(4)}-${structure.pivotZone.high.toFixed(4)}`
    : "none";
  return `Chan trend=${structure.trend} strokes=${structure.strokes.length} pivot=${pivot} position=${structure.pricePosition} divergence=${structure.divergence} setup=${structure.setup}`;
}
