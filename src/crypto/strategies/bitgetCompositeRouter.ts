import type { CryptoMarketAnalysis, CryptoSignal, CryptoStrategyConfig } from "../types";
import type { CryptoStrategy, StrategySignalInput } from "../strategyTypes";
import { buildShortTradePlan, clampScore, defaultTrendForAnalysis } from "../tradeMath";
import { aberrationVolatilityBreakoutStrategy } from "./aberrationVolatilityBreakout";
import { bollingerBreakevenStrategy } from "./bollingerBreakeven";
import { vwapPullbackReclaimStrategy } from "./vwapPullbackReclaim";

const DEFAULT_ORDER_USDT = 10;

interface BranchSignal {
  name: "trend" | "reversion" | "exit";
  signal: CryptoSignal;
}

function strongest(signals: CryptoSignal[]): CryptoSignal {
  return [...signals].sort((a, b) => b.score - a.score)[0];
}

function branchStatus(name: string, signal: CryptoSignal, executableAction: "buy" | "sell" = "buy"): string {
  const status = `${name}=${signal.action === executableAction ? "executable" : "blocked"}:score=${signal.score.toFixed(1)}`;
  const blocker =
    signal.action === executableAction
      ? undefined
      : signal.reasons.find((reason) => /risk-off/i.test(reason)) ??
        signal.reasons.find((reason) => /disabled/i.test(reason)) ??
        signal.reasons.find((reason) => /blocked|outside|missing|not /i.test(reason));
  return blocker ? `${status}:${blocker}` : status;
}

function prependReason(signal: CryptoSignal, reason: string, branchSummaries: string[]): CryptoSignal {
  return {
    ...signal,
    reasons: [reason, ...branchSummaries, ...signal.reasons]
  };
}

function holdFromBranches(symbol: string, price: number, orderQuoteQty: number, branches: BranchSignal[]): CryptoSignal {
  const best = strongest(branches.map((branch) => branch.signal));
  return {
    symbol,
    action: "hold",
    score: best.score,
    entryPrice: price,
    stopLoss: price,
    takeProfit: price,
    orderQuoteQty,
    maxHoldingMinutes: best.maxHoldingMinutes,
    reasons: [
      "Bitget composite hold: no single branch has executable edge after routing",
      ...branches.map((branch) => branchStatus(branch.name, branch.signal, branch.name === "exit" ? "sell" : "buy")),
      ...best.reasons.slice(0, 8)
    ]
  };
}

function isStrongTrendContext(analysis: CryptoMarketAnalysis): boolean {
  const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
  return trend.trend === "bullish" && trend.higherTrend === "bullish" && trend.rsi <= 74 && analysis.priceVsVwapPct <= 2.4;
}

function isPullbackContext(analysis: CryptoMarketAnalysis): boolean {
  const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
  return analysis.volumeProfile.currentPricePosition === "inside_value" && trend.rsi >= 38 && trend.rsi <= 68 && analysis.priceVsVwapPct <= 0.95;
}

function overextensionExitSignal(analysis: CryptoMarketAnalysis, orderQuoteQty: number, config: CryptoStrategyConfig): CryptoSignal {
  const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
  const bands = analysis.technical?.bollinger;
  const reasons: string[] = [];
  let score = 42;

  if (bands && (bands.percentB >= 0.96 || analysis.price >= bands.upper)) {
    score += 22;
    reasons.push("Bollinger upper extension is stretched");
  }
  if (analysis.priceVsVwapPct >= Math.max(2.8, config.maxPriceVwapPct)) {
    score += 18;
    reasons.push(`VWAP extension ${analysis.priceVsVwapPct.toFixed(2)}% is overheated`);
  }
  if (trend.rsi >= 76) {
    score += 16;
    reasons.push(`RSI ${trend.rsi.toFixed(1)} is overheated for a fresh long`);
  }
  if (analysis.volumeProfile.currentPricePosition === "above_value") {
    score += 10;
    reasons.push("Price is above value area; prefer high-sell/exit logic");
  }
  if (trend.emaFastSlopePct <= 0 || analysis.footprint.buySellImbalance <= 0 || analysis.deepTrades.largeTradeBuyRatio <= 0.5) {
    score += 10;
    reasons.push("Momentum/flow is no longer confirming upside continuation");
  }

  const clampedScore = clampScore(score);
  const plan = buildShortTradePlan({ analysis, trend, score: clampedScore, orderQuoteQty, config });
  const executable = clampedScore >= config.minBuyScore && reasons.length >= 4;

  return {
    symbol: analysis.symbol,
    action: executable ? "sell" : "hold",
    score: clampedScore,
    entryPrice: plan.entryPrice,
    stopLoss: plan.stopLoss,
    takeProfit: plan.takeProfit,
    orderQuoteQty: plan.orderQuoteQty,
    maxHoldingMinutes: Math.min(config.maxHoldingMinutes, 45),
    reasons: executable
      ? ["Exit invalidation: Bitget composite overextension high-sell exit", ...reasons]
      : [...reasons, "Overextension exit branch is not decisive enough"]
  };
}

function reversionSignal(input: StrategySignalInput): CryptoSignal {
  const signal = strongest([
    vwapPullbackReclaimStrategy.generateSignal(input),
    bollingerBreakevenStrategy.generateSignal(input)
  ]);
  if (input.analysis.marketRegime && !input.analysis.marketRegime.isRiskOn && signal.action === "buy") {
    return {
      ...signal,
      action: "hold",
      reasons: [...signal.reasons, `Reversion blocked: ${input.analysis.marketRegime.benchmarkSymbol} benchmark is risk-off`]
    };
  }
  return signal;
}

function disabledBranchReason(symbol: string, branch: BranchSignal["name"]): string | undefined {
  const upperSymbol = symbol.toUpperCase();
  if (upperSymbol === "BTCUSDT" && branch === "reversion") {
    return "BTCUSDT reversion branch is disabled after 90d Bitget attribution showed negative expectancy";
  }
  if (upperSymbol === "XRPUSDT" && branch === "trend") {
    return "XRPUSDT trend branch is disabled after 90d Bitget attribution showed negative expectancy";
  }
  return undefined;
}

function applyBranchGate(symbol: string, branch: BranchSignal): BranchSignal {
  const reason = disabledBranchReason(symbol, branch.name);
  if (!reason) {
    return branch;
  }
  return {
    name: branch.name,
    signal: {
      ...branch.signal,
      action: "hold",
      reasons: [...branch.signal.reasons, reason]
    }
  };
}

export const bitgetCompositeRouterStrategy: CryptoStrategy = {
  id: "bitget-composite-router",
  label: "Bitget composite trend/reversion/exit router",
  readiness: "no_trade",
  blockedReason: "365d Bitget native futures backtest failed: return -232.4085%, PF 0.5253, maxDD 258.7426%",
  generateSignal: ({ analysis, orderQuoteQty = DEFAULT_ORDER_USDT, config }) => {
    const trend = aberrationVolatilityBreakoutStrategy.generateSignal({ analysis, orderQuoteQty, config });
    const reversion = reversionSignal({ analysis, orderQuoteQty, config });
    const exit = overextensionExitSignal(analysis, orderQuoteQty, config);
    const rawBranches: BranchSignal[] = [
      { name: "trend", signal: trend },
      { name: "reversion", signal: reversion },
      { name: "exit", signal: exit }
    ];
    const branches = rawBranches.map((branch) => applyBranchGate(analysis.symbol, branch));
    const gatedTrend = branches.find((branch) => branch.name === "trend")!.signal;
    const gatedReversion = branches.find((branch) => branch.name === "reversion")!.signal;
    const gatedExit = branches.find((branch) => branch.name === "exit")!.signal;
    const summaries = branches.map((branch) => branchStatus(branch.name, branch.signal, branch.name === "exit" ? "sell" : "buy"));

    if (gatedExit.action === "sell") {
      return prependReason(gatedExit, "Bitget composite selected overextension exit branch", summaries);
    }
    if (gatedTrend.action === "buy" && isStrongTrendContext(analysis)) {
      return prependReason(gatedTrend, "Bitget composite selected trend branch", summaries);
    }
    if (gatedReversion.action === "buy" && isPullbackContext(analysis)) {
      return prependReason(gatedReversion, "Bitget composite selected reversion branch", summaries);
    }

    return holdFromBranches(analysis.symbol, analysis.price, orderQuoteQty, branches);
  }
};
