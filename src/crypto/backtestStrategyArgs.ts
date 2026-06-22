import type { CryptoStrategyConfig } from "./types";

export interface CandidateStrategyArgs {
  strategyId: string;
  strategy: CryptoStrategyConfig;
}

export interface BacktestSymbolRunnerArgsInput {
  symbolRunner: string;
  symbol: string;
  days: number;
  candidate: CandidateStrategyArgs;
}

export interface ParsedBacktestSymbolArgs {
  symbol: string;
  days: number;
  strategyId: string | undefined;
  strategy: CryptoStrategyConfig;
}

export function buildBacktestSymbolRunnerArgs(input: BacktestSymbolRunnerArgsInput): string[] {
  const strategy = input.candidate.strategy;
  return [
    input.symbolRunner,
    input.symbol,
    String(input.days),
    String(strategy.minBuyScore),
    String(strategy.atrStopMultiplier),
    String(strategy.takeProfitRiskMultiple),
    String(strategy.minPriceVwapPct),
    String(strategy.maxPriceVwapPct),
    String(strategy.minEmaFastSlopePct),
    String(strategy.minTakeProfitPct),
    String(strategy.minExpectedValuePct),
    input.candidate.strategyId,
    String(strategy.maxHoldingMinutes),
    String(strategy.entryCooldownMinutes),
    String(strategy.breakevenTriggerPct),
    String(strategy.trailingStopTriggerPct),
    String(strategy.trailingStopGivebackPct),
    String(strategy.signalExitScore)
  ];
}

export function parseBacktestSymbolArgs(args: string[], fallback: CryptoStrategyConfig): ParsedBacktestSymbolArgs {
  const [
    symbolArg,
    daysArg,
    minScoreArg,
    atrArg,
    takeProfitArg,
    minPriceVwapArg,
    maxPriceVwapArg,
    minEmaFastSlopeArg,
    minTakeProfitArg,
    minExpectedValueArg,
    strategyIdArg,
    maxHoldingMinutesArg,
    entryCooldownMinutesArg,
    breakevenTriggerPctArg,
    trailingStopTriggerPctArg,
    trailingStopGivebackPctArg,
    signalExitScoreArg
  ] = args;

  return {
    symbol: symbolArg,
    days: asNumber(daysArg, 14),
    strategyId: strategyIdArg,
    strategy: {
      ...fallback,
      minBuyScore: asNumber(minScoreArg, fallback.minBuyScore),
      atrStopMultiplier: asNumber(atrArg, fallback.atrStopMultiplier),
      takeProfitRiskMultiple: asNumber(takeProfitArg, fallback.takeProfitRiskMultiple),
      minPriceVwapPct: asNumber(minPriceVwapArg, fallback.minPriceVwapPct),
      maxPriceVwapPct: asNumber(maxPriceVwapArg, fallback.maxPriceVwapPct),
      minEmaFastSlopePct: asNumber(minEmaFastSlopeArg, fallback.minEmaFastSlopePct),
      minTakeProfitPct: asNumber(minTakeProfitArg, fallback.minTakeProfitPct),
      minExpectedValuePct: asNumber(minExpectedValueArg, fallback.minExpectedValuePct),
      maxHoldingMinutes: asNumber(maxHoldingMinutesArg, fallback.maxHoldingMinutes),
      entryCooldownMinutes: asNumber(entryCooldownMinutesArg, fallback.entryCooldownMinutes),
      breakevenTriggerPct: asNumber(breakevenTriggerPctArg, fallback.breakevenTriggerPct),
      trailingStopTriggerPct: asNumber(trailingStopTriggerPctArg, fallback.trailingStopTriggerPct),
      trailingStopGivebackPct: asNumber(trailingStopGivebackPctArg, fallback.trailingStopGivebackPct),
      signalExitScore: asNumber(signalExitScoreArg, fallback.signalExitScore)
    }
  };
}

function asNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
