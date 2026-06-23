import type { ParsedKline } from "./types";

export type ResearchExitReason = "take_profit" | "stop_loss" | "timeout";

export interface ResearchLabelOptions {
  horizonBars: number;
  takeProfitPct: number;
  stopLossPct: number;
  costPct: number;
}

export interface ResearchOutcome {
  reason: ResearchExitReason;
  exitIndex: number;
  exitPrice: number;
  grossMovePct: number;
  netPnlPct: number;
  mfePct: number;
  maePct: number;
}

export interface ResearchScenarioSummary {
  name: string;
  description?: string;
  trades: number;
  netPnlPct: number;
  avgPnlPct: number;
  grossMovePct: number;
  avgGrossMovePct: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  avgMfePct: number;
  avgMaePct: number;
  reasonCounts: Record<ResearchExitReason, number>;
  score: number;
}

export interface ResearchAccumulator {
  name: string;
  description?: string;
  trades: number;
  wins: number;
  netPnlPct: number;
  grossMovePct: number;
  winningPnlPct: number;
  losingPnlPct: number;
  mfePct: number;
  maePct: number;
  equityPct: number;
  peakPct: number;
  maxDrawdownPct: number;
  reasonCounts: Record<ResearchExitReason, number>;
}

export function labelLongOutcome(rows: ParsedKline[], entryIndex: number, options: ResearchLabelOptions): ResearchOutcome {
  const entry = rows[entryIndex];
  if (!entry || entry.close <= 0) {
    throw new Error(`Cannot label long outcome at missing or invalid entry index ${entryIndex}`);
  }

  const lastIndex = Math.min(rows.length - 1, entryIndex + Math.max(1, options.horizonBars));
  if (lastIndex <= entryIndex) {
    throw new Error(`Cannot label long outcome without future bars at entry index ${entryIndex}`);
  }

  const takeProfitPrice = entry.close * (1 + options.takeProfitPct / 100);
  const stopLossPrice = entry.close * (1 - options.stopLossPct / 100);
  let mfePct = Number.NEGATIVE_INFINITY;
  let maePct = Number.POSITIVE_INFINITY;

  for (let index = entryIndex + 1; index <= lastIndex; index += 1) {
    const row = rows[index];
    mfePct = Math.max(mfePct, ((row.high - entry.close) / entry.close) * 100);
    maePct = Math.min(maePct, ((row.low - entry.close) / entry.close) * 100);

    if (row.low <= stopLossPrice) {
      return outcome("stop_loss", index, stopLossPrice, entry.close, options.costPct, mfePct, maePct);
    }
    if (row.high >= takeProfitPrice) {
      return outcome("take_profit", index, takeProfitPrice, entry.close, options.costPct, mfePct, maePct);
    }
  }

  const exit = rows[lastIndex];
  mfePct = Number.isFinite(mfePct) ? mfePct : 0;
  maePct = Number.isFinite(maePct) ? maePct : 0;
  return outcome("timeout", lastIndex, exit.close, entry.close, options.costPct, mfePct, maePct);
}

export function labelShortOutcome(rows: ParsedKline[], entryIndex: number, options: ResearchLabelOptions): ResearchOutcome {
  const entry = rows[entryIndex];
  if (!entry || entry.close <= 0) {
    throw new Error(`Cannot label short outcome at missing or invalid entry index ${entryIndex}`);
  }

  const lastIndex = Math.min(rows.length - 1, entryIndex + Math.max(1, options.horizonBars));
  if (lastIndex <= entryIndex) {
    throw new Error(`Cannot label short outcome without future bars at entry index ${entryIndex}`);
  }

  const takeProfitPrice = entry.close * (1 - options.takeProfitPct / 100);
  const stopLossPrice = entry.close * (1 + options.stopLossPct / 100);
  let mfePct = Number.NEGATIVE_INFINITY;
  let maePct = Number.POSITIVE_INFINITY;

  for (let index = entryIndex + 1; index <= lastIndex; index += 1) {
    const row = rows[index];
    mfePct = Math.max(mfePct, ((entry.close - row.low) / entry.close) * 100);
    maePct = Math.min(maePct, -((row.high - entry.close) / entry.close) * 100);

    if (row.high >= stopLossPrice) {
      return shortOutcome("stop_loss", index, stopLossPrice, entry.close, options.costPct, mfePct, maePct);
    }
    if (row.low <= takeProfitPrice) {
      return shortOutcome("take_profit", index, takeProfitPrice, entry.close, options.costPct, mfePct, maePct);
    }
  }

  const exit = rows[lastIndex];
  mfePct = Number.isFinite(mfePct) ? mfePct : 0;
  maePct = Number.isFinite(maePct) ? maePct : 0;
  return shortOutcome("timeout", lastIndex, exit.close, entry.close, options.costPct, mfePct, maePct);
}

export function createResearchAccumulator(name: string, description?: string): ResearchAccumulator {
  return {
    name,
    description,
    trades: 0,
    wins: 0,
    netPnlPct: 0,
    grossMovePct: 0,
    winningPnlPct: 0,
    losingPnlPct: 0,
    mfePct: 0,
    maePct: 0,
    equityPct: 0,
    peakPct: 0,
    maxDrawdownPct: 0,
    reasonCounts: { take_profit: 0, stop_loss: 0, timeout: 0 }
  };
}

export function addOutcome(accumulator: ResearchAccumulator, outcomeValue: ResearchOutcome): void {
  accumulator.trades += 1;
  accumulator.netPnlPct += outcomeValue.netPnlPct;
  accumulator.grossMovePct += outcomeValue.grossMovePct;
  accumulator.mfePct += outcomeValue.mfePct;
  accumulator.maePct += outcomeValue.maePct;
  accumulator.reasonCounts[outcomeValue.reason] += 1;

  if (outcomeValue.netPnlPct > 0) {
    accumulator.wins += 1;
    accumulator.winningPnlPct += outcomeValue.netPnlPct;
  } else if (outcomeValue.netPnlPct < 0) {
    accumulator.losingPnlPct += outcomeValue.netPnlPct;
  }

  accumulator.equityPct += outcomeValue.netPnlPct;
  accumulator.peakPct = Math.max(accumulator.peakPct, accumulator.equityPct);
  accumulator.maxDrawdownPct = Math.max(accumulator.maxDrawdownPct, accumulator.peakPct - accumulator.equityPct);
}

export function finishAccumulator(accumulator: ResearchAccumulator): ResearchScenarioSummary {
  const trades = accumulator.trades;
  const profitFactor =
    accumulator.losingPnlPct < 0 ? accumulator.winningPnlPct / Math.abs(accumulator.losingPnlPct) : accumulator.winningPnlPct > 0 ? 999 : 0;

  return {
    name: accumulator.name,
    description: accumulator.description,
    trades,
    netPnlPct: accumulator.netPnlPct,
    avgPnlPct: trades > 0 ? accumulator.netPnlPct / trades : 0,
    grossMovePct: accumulator.grossMovePct,
    avgGrossMovePct: trades > 0 ? accumulator.grossMovePct / trades : 0,
    winRate: trades > 0 ? accumulator.wins / trades : 0,
    profitFactor,
    maxDrawdownPct: accumulator.maxDrawdownPct,
    avgMfePct: trades > 0 ? accumulator.mfePct / trades : 0,
    avgMaePct: trades > 0 ? accumulator.maePct / trades : 0,
    reasonCounts: { ...accumulator.reasonCounts },
    score: scoreAccumulator(accumulator, profitFactor)
  };
}

export function summarizeOutcomes(name: string, outcomes: ResearchOutcome[], description?: string): ResearchScenarioSummary {
  const accumulator = createResearchAccumulator(name, description);
  for (const item of outcomes) {
    addOutcome(accumulator, item);
  }
  return finishAccumulator(accumulator);
}

function outcome(
  reason: ResearchExitReason,
  exitIndex: number,
  exitPrice: number,
  entryPrice: number,
  costPct: number,
  mfePct: number,
  maePct: number
): ResearchOutcome {
  const grossMovePct = ((exitPrice - entryPrice) / entryPrice) * 100;
  return {
    reason,
    exitIndex,
    exitPrice,
    grossMovePct,
    netPnlPct: grossMovePct - costPct,
    mfePct,
    maePct
  };
}

function shortOutcome(
  reason: ResearchExitReason,
  exitIndex: number,
  exitPrice: number,
  entryPrice: number,
  costPct: number,
  mfePct: number,
  maePct: number
): ResearchOutcome {
  const grossMovePct = ((entryPrice - exitPrice) / entryPrice) * 100;
  return {
    reason,
    exitIndex,
    exitPrice,
    grossMovePct,
    netPnlPct: grossMovePct - costPct,
    mfePct,
    maePct
  };
}

function scoreAccumulator(accumulator: ResearchAccumulator, profitFactor: number): number {
  if (accumulator.trades === 0) {
    return 0;
  }

  const sampleBonus = Math.min(accumulator.trades, 600) / 120;
  const winRateBonus = (accumulator.wins / accumulator.trades) * 8;
  const cappedProfitFactorBonus = Math.min(profitFactor, 3) * 5;
  return accumulator.netPnlPct + sampleBonus + winRateBonus + cappedProfitFactorBonus - accumulator.maxDrawdownPct * 0.35;
}
