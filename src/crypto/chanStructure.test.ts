import { describe, expect, it } from "vitest";
import { analyzeChanStructure, formatChanStructureLabel, normalizeChanRows } from "./chanStructure";
import type { ParsedKline } from "./types";

function row(index: number, high: number, low: number, close = (high + low) / 2): ParsedKline {
  return {
    openTime: index * 5 * 60 * 1000,
    open: close,
    high,
    low,
    close,
    volume: 10,
    quoteVolume: close * 10
  };
}

describe("Chan structure", () => {
  it("merges contained candles before deriving fractals", () => {
    const normalized = normalizeChanRows([
      row(0, 100, 90, 95),
      row(1, 99, 92, 96),
      row(2, 103, 94, 101),
      row(3, 101, 96, 100)
    ]);

    expect(normalized).toHaveLength(2);
    expect(normalized[0].high).toBe(100);
    expect(normalized[0].low).toBe(92);
    expect(normalized[1].high).toBe(103);
    expect(normalized[1].low).toBe(96);
  });

  it("builds strokes, latest pivot zone, and bullish divergence from completed swings", () => {
    const structure = analyzeChanStructure(
      [
        row(0, 100, 90),
        row(1, 105, 94),
        row(2, 101, 93),
        row(3, 100, 88),
        row(4, 102, 90),
        row(5, 108, 96),
        row(6, 103, 95),
        row(7, 101, 87),
        row(8, 103, 89),
        row(9, 106, 94),
        row(10, 102, 93),
        row(11, 100, 86),
        row(12, 102, 88)
      ],
      { includeLast: true }
    );

    expect(structure.fractals.map((fractal) => fractal.kind)).toEqual(["top", "bottom", "top", "bottom", "top", "bottom"]);
    expect(structure.strokes.map((stroke) => stroke.direction)).toEqual(["down", "up", "down", "up", "down"]);
    expect(structure.pivotZone).toMatchObject({ low: 87, high: 106, strokeCount: 3 });
    expect(structure.divergence).toBe("bullish");
    expect(structure.setup).toBe("buy_divergence");
  });

  it("formats one compact journal label for later paper review", () => {
    const label = formatChanStructureLabel({
      trend: "down",
      fractals: [],
      strokes: [],
      pivotZone: { low: 93, high: 106, startOpenTime: 0, endOpenTime: 1, strokeCount: 3 },
      pricePosition: "inside_pivot",
      divergence: "bullish",
      setup: "buy_divergence"
    });

    expect(label).toBe("Chan trend=down strokes=0 pivot=93.0000-106.0000 position=inside_pivot divergence=bullish setup=buy_divergence");
  });
});
