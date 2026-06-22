import type { CryptoMarketAnalysis, CryptoStrategyConfig, CryptoTrendMetrics } from "./types";

export interface TradePlan {
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  takeProfitPct: number;
  stopLossPct: number;
  orderQuoteQty: number;
  estimatedRoundTripCostPct: number;
  expectedValuePct: number;
}

export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

export function defaultTrendForAnalysis(analysis: CryptoMarketAnalysis): CryptoTrendMetrics {
  return {
    emaFast: analysis.price,
    emaSlow: analysis.price,
    emaTrend: analysis.price,
    emaFastSlopePct: 0,
    higherEmaFast: analysis.price,
    higherEmaSlow: analysis.price,
    rsi: 50,
    atr: analysis.price * 0.002,
    atrPct: 0.2,
    trend: "neutral",
    higherTrend: "neutral"
  };
}

export function trendGapPct(trend: CryptoTrendMetrics): number {
  return trend.higherEmaSlow > 0 ? ((trend.higherEmaFast - trend.higherEmaSlow) / trend.higherEmaSlow) * 100 : 0;
}

export function roundTripCostPct(config: CryptoStrategyConfig): number {
  return config.feeRate * 2 * 100 + config.estimatedSlippagePct + config.priceImpactPct;
}

export function buildLongTradePlan(input: {
  analysis: CryptoMarketAnalysis;
  trend: CryptoTrendMetrics;
  score: number;
  orderQuoteQty: number;
  config: CryptoStrategyConfig;
}): TradePlan {
  const entryPrice = input.analysis.price;
  const atrStop = entryPrice - input.trend.atr * input.config.atrStopMultiplier;
  const vwapStop = input.analysis.vwap > 0 && input.analysis.vwap < entryPrice ? input.analysis.vwap * 0.997 : atrStop;
  const stopLoss = Math.min(entryPrice * 0.999, Math.max(atrStop, vwapStop));
  const takeProfit = entryPrice + (entryPrice - stopLoss) * input.config.takeProfitRiskMultiple;
  const takeProfitPct = entryPrice > 0 ? ((takeProfit - entryPrice) / entryPrice) * 100 : 0;
  const stopLossPct = entryPrice > 0 ? ((entryPrice - stopLoss) / entryPrice) * 100 : 0;
  const orderQuoteQty =
    stopLossPct > 0 && input.config.maxPositionLossUsdt
      ? Math.min(input.orderQuoteQty, input.config.maxPositionLossUsdt / (stopLossPct / 100))
      : input.orderQuoteQty;
  const probabilityWin = Math.max(0.05, Math.min(0.85, clampScore(input.score) / 100));
  const estimatedRoundTripCostPct = roundTripCostPct(input.config);
  const expectedValuePct = probabilityWin * takeProfitPct - (1 - probabilityWin) * stopLossPct - estimatedRoundTripCostPct;

  return {
    entryPrice,
    stopLoss,
    takeProfit,
    takeProfitPct,
    stopLossPct,
    orderQuoteQty: Number(orderQuoteQty.toFixed(8)),
    estimatedRoundTripCostPct,
    expectedValuePct
  };
}

export function buildShortTradePlan(input: {
  analysis: CryptoMarketAnalysis;
  trend: CryptoTrendMetrics;
  score: number;
  orderQuoteQty: number;
  config: CryptoStrategyConfig;
}): TradePlan {
  const entryPrice = input.analysis.price;
  const atrStop = entryPrice + input.trend.atr * input.config.atrStopMultiplier;
  const vwapStop = input.analysis.vwap > 0 && input.analysis.vwap > entryPrice ? input.analysis.vwap * 1.003 : atrStop;
  const stopLoss = Math.max(entryPrice * 1.001, Math.min(atrStop, vwapStop));
  const takeProfit = entryPrice - (stopLoss - entryPrice) * input.config.takeProfitRiskMultiple;
  const takeProfitPct = entryPrice > 0 ? ((entryPrice - takeProfit) / entryPrice) * 100 : 0;
  const stopLossPct = entryPrice > 0 ? ((stopLoss - entryPrice) / entryPrice) * 100 : 0;
  const orderQuoteQty =
    stopLossPct > 0 && input.config.maxPositionLossUsdt
      ? Math.min(input.orderQuoteQty, input.config.maxPositionLossUsdt / (stopLossPct / 100))
      : input.orderQuoteQty;
  const probabilityWin = Math.max(0.05, Math.min(0.85, clampScore(input.score) / 100));
  const estimatedRoundTripCostPct = roundTripCostPct(input.config);
  const expectedValuePct = probabilityWin * takeProfitPct - (1 - probabilityWin) * stopLossPct - estimatedRoundTripCostPct;

  return {
    entryPrice,
    stopLoss,
    takeProfit,
    takeProfitPct,
    stopLossPct,
    orderQuoteQty: Number(orderQuoteQty.toFixed(8)),
    estimatedRoundTripCostPct,
    expectedValuePct
  };
}
