export type BitgetVolumeRegime =
  | "volume_breakout_confirmation"
  | "pullback_volume_contraction"
  | "crowded_positioning_risk"
  | "neutral"
  | "blocked";

export interface BitgetVolumeFeatureInput {
  closePctChange: number;
  volumeRatio: number;
  openInterestPctChange: number | null;
  fundingRate: number | null;
  longShortRatio: number | null;
}

export interface BitgetVolumeFeature {
  regime: BitgetVolumeRegime;
  rawScore: number;
  blocked?: string;
}

function missing(field: string): BitgetVolumeFeature {
  return {
    regime: "blocked",
    rawScore: 0,
    blocked: `blocked=data_missing field=${field}`
  };
}

export function buildBitgetVolumeFeature(input: BitgetVolumeFeatureInput): BitgetVolumeFeature {
  if (input.openInterestPctChange === null) return missing("openInterestPctChange");
  if (input.fundingRate === null) return missing("fundingRate");
  if (input.longShortRatio === null) return missing("longShortRatio");

  if (Math.abs(input.fundingRate) >= 0.0012 || input.longShortRatio >= 2 || input.longShortRatio <= 0.5) {
    return { regime: "crowded_positioning_risk", rawScore: 35 };
  }

  if (input.closePctChange > 0.5 && input.volumeRatio >= 1.8 && input.openInterestPctChange > 1) {
    return { regime: "volume_breakout_confirmation", rawScore: 82 };
  }

  if (Math.abs(input.closePctChange) < 0.25 && input.volumeRatio < 0.8 && input.openInterestPctChange <= 0) {
    return { regime: "pullback_volume_contraction", rawScore: 68 };
  }

  return { regime: "neutral", rawScore: 45 };
}
