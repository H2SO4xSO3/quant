import { defaultTrendForAnalysis } from "./tradeMath";
import type { CryptoMarketAnalysis, CryptoMarketRegime } from "./types";

export function assessMarketRegime(benchmark: CryptoMarketAnalysis): CryptoMarketRegime {
  const trend = benchmark.trend ?? defaultTrendForAnalysis(benchmark);
  const channel = benchmark.technical?.volatilityChannel;
  const volumeRatio = benchmark.technical?.volumeRatio ?? 1;
  const volatilityBandwidthPct = channel?.bandwidthPct ?? benchmark.volatilityPct;
  const reasons: string[] = [];

  if (trend.trend !== "bullish" || trend.higherTrend !== "bullish" || benchmark.price <= trend.emaTrend) {
    reasons.push(`${benchmark.symbol} benchmark trend is not bullish`);
  }

  if (trend.rsi < 45) {
    reasons.push(`${benchmark.symbol} benchmark RSI ${trend.rsi.toFixed(1)} shows weak momentum`);
  } else if (trend.rsi > 78) {
    reasons.push(`${benchmark.symbol} benchmark RSI ${trend.rsi.toFixed(1)} is overheated`);
  }

  if (trend.atrPct > 1.6) {
    reasons.push(`${benchmark.symbol} benchmark ATR ${trend.atrPct.toFixed(2)}% is in a high-risk spike`);
  }

  if (volatilityBandwidthPct < 0.35) {
    reasons.push(`${benchmark.symbol} benchmark volatility channel is too compressed`);
  }

  if (volumeRatio < 0.85) {
    reasons.push(`${benchmark.symbol} benchmark volume ratio ${volumeRatio.toFixed(2)} is below expansion threshold`);
  }

  const isRiskOn = reasons.length === 0;

  return {
    benchmarkSymbol: benchmark.symbol,
    isRiskOn,
    trend: trend.trend,
    higherTrend: trend.higherTrend,
    volumeRatio,
    volatilityBandwidthPct,
    atrPct: trend.atrPct,
    reasons: isRiskOn ? [`${benchmark.symbol} benchmark is risk-on for long breakout research`] : reasons
  };
}
