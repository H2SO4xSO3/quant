import { emaVwapTrendStrategy } from "../strategy";
import type { CryptoStrategy } from "../strategyTypes";
import { roundTripCostPct } from "../tradeMath";
import type { CryptoSignal } from "../types";
import { vwapBreakdownShortStrategy } from "./vwapBreakdownShort";

const SELECTOR_COST_MULTIPLE = 4;

export interface OpportunitySelectorOptions {
  minExecutableTakeProfitPct?: number;
}

function ranked(signals: CryptoSignal[]): CryptoSignal[] {
  return [...signals].sort((a, b) => b.score - a.score);
}

function targetPct(signal: CryptoSignal): number {
  return signal.entryPrice > 0 ? (Math.abs(signal.takeProfit - signal.entryPrice) / signal.entryPrice) * 100 : 0;
}

function blockThinTarget(signal: CryptoSignal, minExecutableTakeProfitPct?: number): CryptoSignal {
  if (signal.action !== "buy" && signal.action !== "sell") {
    return signal;
  }
  if (minExecutableTakeProfitPct === undefined) {
    return signal;
  }
  const grossTargetPct = targetPct(signal);
  if (grossTargetPct >= minExecutableTakeProfitPct) {
    return signal;
  }
  return {
    ...signal,
    action: "hold",
    reasons: [
      ...signal.reasons,
      `Selector blocked ${signal.action}: gross target ${grossTargetPct.toFixed(2)}% does not clear ${minExecutableTakeProfitPct.toFixed(2)}% 50x friction floor`
    ]
  };
}

export function chooseBestOpportunitySignal(signals: CryptoSignal[], options: OpportunitySelectorOptions = {}): CryptoSignal {
  const costFilteredSignals = signals.map((signal) => blockThinTarget(signal, options.minExecutableTakeProfitPct));
  const executable = ranked(costFilteredSignals).find((signal) => signal.action === "buy" || signal.action === "sell");
  if (executable) {
    return {
      ...executable,
      reasons: [...executable.reasons, `50x opportunity selector picked ${executable.action} score=${executable.score.toFixed(1)}`]
    };
  }

  const strongest = ranked(costFilteredSignals)[0];
  if (strongest) {
    return {
      ...strongest,
      action: "hold",
      reasons: ["No executable 50x opportunity passed current long/short gates", ...strongest.reasons]
    };
  }

  return {
    symbol: "NONE",
    action: "hold",
    score: 0,
    entryPrice: 0,
    stopLoss: 0,
    takeProfit: 0,
    orderQuoteQty: 0,
    reasons: ["No executable 50x opportunity passed current long/short gates"]
  };
}

export const futuresOpportunity50xStrategy: CryptoStrategy = {
  id: "futures-opportunity-50x",
  label: "Futures 50x long-or-short opportunity selector",
  generateSignal: (input) => chooseBestOpportunitySignal(
    [
      emaVwapTrendStrategy.generateSignal(input),
      vwapBreakdownShortStrategy.generateSignal(input)
    ],
    { minExecutableTakeProfitPct: roundTripCostPct(input.config) * SELECTOR_COST_MULTIPLE }
  )
};
