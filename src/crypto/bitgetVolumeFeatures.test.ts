import { describe, expect, it } from "vitest";
import { buildBitgetVolumeFeature } from "./bitgetVolumeFeatures";

describe("Bitget volume feature builder", () => {
  it("classifies breakout continuation only when price, volume, and OI expand together", () => {
    const feature = buildBitgetVolumeFeature({
      closePctChange: 0.82,
      volumeRatio: 2.1,
      openInterestPctChange: 1.4,
      fundingRate: 0.0002,
      longShortRatio: 1.05
    });

    expect(feature.regime).toBe("volume_breakout_confirmation");
    expect(feature.rawScore).toBeGreaterThanOrEqual(80);
    expect(feature.blocked).toBeUndefined();
  });

  it("blocks feature output when true Bitget market context is missing", () => {
    const feature = buildBitgetVolumeFeature({
      closePctChange: 0.82,
      volumeRatio: 2.1,
      openInterestPctChange: null,
      fundingRate: 0.0002,
      longShortRatio: 1.05
    });

    expect(feature).toEqual({
      regime: "blocked",
      rawScore: 0,
      blocked: "blocked=data_missing field=openInterestPctChange"
    });
  });

  it("classifies crowded positioning as risk instead of an entry edge", () => {
    const feature = buildBitgetVolumeFeature({
      closePctChange: 0.1,
      volumeRatio: 1.1,
      openInterestPctChange: 0.4,
      fundingRate: 0.0015,
      longShortRatio: 2.4
    });

    expect(feature.regime).toBe("crowded_positioning_risk");
    expect(feature.rawScore).toBeLessThan(50);
  });
});
