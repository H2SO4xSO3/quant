import type { CryptoStrategy } from "./strategyTypes";
import type { CryptoSignal } from "./types";

export interface PaperAggressiveOptions {
  minScore?: number;
  minPositiveHigherGapPct?: number;
}

const DEFAULT_AGGRESSIVE_MIN_SCORE = 98;
const DEFAULT_MIN_POSITIVE_HIGHER_GAP_PCT = 0.02;
const AGGRESSIVE_OVERRIDE_REASON = "Paper aggressive override: tolerated small positive 15m gap lag for simulation only";
const HIGHER_GAP_PATTERN = /^15m EMA gap (-?[0-9.]+)% is below the .* trend floor/i;

const criticalBlockers = [
  /^5m EMA trend is not bullish/i,
  /^15m EMA trend is not bullish/i,
  /^15m trend conflicts/i,
  /Price is not above VWAP/i,
  /Price is below VWAP/i,
  /Price is only .* below the .* minimum/i,
  /too extended for a fresh entry/i,
  /5m EMA slope .* below/i,
  /RSI .* outside/i,
  /ATR .* too high/i,
  /Gross take-profit .* does not clear/i,
  /Expected value .* below/i,
  /Nearest ask distance .* above/i,
  /Footprint shows taker-sell imbalance/i,
  /Large trades lean sell-side/i,
  /Order book has heavier ask pressure/i,
  /Order book does not show stronger bid support/i,
  /Entry lacks at least two bullish flow confirmations/i,
  /Price is above value area; avoid chasing/i
];

function hasCriticalBlocker(signal: CryptoSignal): boolean {
  return signal.reasons.some((reason) => criticalBlockers.some((pattern) => pattern.test(reason)));
}

function parseHigherGapPct(reason: string): number | undefined {
  const match = reason.match(HIGHER_GAP_PATTERN);
  return match ? Number(match[1]) : undefined;
}

function hasEligibleSmallPositiveHigherGap(signal: CryptoSignal, minPositiveHigherGapPct: number): boolean {
  return signal.reasons.some((reason) => {
    const higherGapPct = parseHigherGapPct(reason);
    return higherGapPct !== undefined && higherGapPct >= minPositiveHigherGapPct;
  });
}

function canOverrideForPaper(signal: CryptoSignal, minScore: number, minPositiveHigherGapPct: number): boolean {
  return (
    signal.action === "hold" &&
    signal.score >= minScore &&
    !hasCriticalBlocker(signal) &&
    hasEligibleSmallPositiveHigherGap(signal, minPositiveHigherGapPct)
  );
}

export function createPaperAggressiveStrategy(base: CryptoStrategy, options: PaperAggressiveOptions = {}): CryptoStrategy {
  const minScore = options.minScore ?? DEFAULT_AGGRESSIVE_MIN_SCORE;
  const minPositiveHigherGapPct = options.minPositiveHigherGapPct ?? DEFAULT_MIN_POSITIVE_HIGHER_GAP_PCT;
  return {
    id: `${base.id}-paper-aggressive`,
    label: `${base.label} paper aggressive`,
    generateSignal(input) {
      const signal = base.generateSignal(input);
      if (!canOverrideForPaper(signal, minScore, minPositiveHigherGapPct)) {
        return signal;
      }

      return {
        ...signal,
        action: "buy",
        reasons: [...signal.reasons, AGGRESSIVE_OVERRIDE_REASON]
      };
    }
  };
}
