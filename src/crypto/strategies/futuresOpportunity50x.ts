import type { CryptoStrategy } from "../strategyTypes";
import { roundTripCostPct } from "../tradeMath";
import type { CryptoSignal } from "../types";
import { videoEmaStructure50xStrategy } from "./videoEmaStructure50x";
import { vwapBreakdownShortStrategy } from "./vwapBreakdownShort";

const SELECTOR_COST_MULTIPLE = 4;
const MAJOR_50X_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT"]);

export interface OpportunitySelectorOptions {
  minExecutableTakeProfitPct?: number;
  minExitQualityTakeProfitPct?: number;
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

function blockWeakExitQuality(signal: CryptoSignal, minExitQualityTakeProfitPct?: number): CryptoSignal {
  if (signal.action !== "buy" && signal.action !== "sell") {
    return signal;
  }
  if (minExitQualityTakeProfitPct === undefined) {
    return signal;
  }
  const grossTargetPct = targetPct(signal);
  if (grossTargetPct >= minExitQualityTakeProfitPct) {
    return signal;
  }
  return {
    ...signal,
    action: "hold",
    reasons: [
      ...signal.reasons,
      `Selector blocked ${signal.action}: gross target ${grossTargetPct.toFixed(2)}% does not clear ${minExitQualityTakeProfitPct.toFixed(2)}% exit-quality floor after 50x costs and timeout risk`
    ]
  };
}

function blockNonMajor(signal: CryptoSignal): CryptoSignal {
  if (signal.action !== "buy" && signal.action !== "sell") {
    return signal;
  }
  if (MAJOR_50X_SYMBOLS.has(signal.symbol.toUpperCase())) {
    return signal;
  }
  return {
    ...signal,
    action: "hold",
    reasons: [...signal.reasons, "50x execution is limited to BTCUSDT, ETHUSDT, BNBUSDT until altcoin paper evidence improves"]
  };
}

export function chooseBestOpportunitySignal(signals: CryptoSignal[], options: OpportunitySelectorOptions = {}): CryptoSignal {
  const costFilteredSignals = signals.map((signal) =>
    blockWeakExitQuality(
      blockThinTarget(blockNonMajor(signal), options.minExecutableTakeProfitPct),
      options.minExitQualityTakeProfitPct
    )
  );
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
      videoEmaStructure50xStrategy.generateSignal(input),
      vwapBreakdownShortStrategy.generateSignal(input)
    ],
    {
      minExecutableTakeProfitPct: roundTripCostPct(input.config) * SELECTOR_COST_MULTIPLE,
      minExitQualityTakeProfitPct: roundTripCostPct(input.config) * (SELECTOR_COST_MULTIPLE + 2)
    }
  )
};
