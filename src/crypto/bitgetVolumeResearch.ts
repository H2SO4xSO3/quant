import type { StrategyReadiness } from "./strategyTypes";
import type { BitgetMarketContext } from "./bitgetMarketData";

export interface BitgetVolumeResearchMetrics {
  trades: number;
  returnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  featureCoveragePct: number;
  walkForwardPasses: number;
  walkForwardWindows: number;
}

export interface BitgetVolumeResearchGrade {
  action: "hold";
  rawScore: number;
  state: StrategyReadiness;
  blocked: string;
  evidence: string;
  nextCheck: string;
}

export interface BitgetVolumeResearchReport extends BitgetVolumeResearchGrade {
  exchange: "bitget";
  productType: "USDT-FUTURES";
  days: number;
  symbols: string[];
  generatedAt: string;
  metrics: BitgetVolumeResearchMetrics;
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateBitgetFeatureCoverage(contexts: BitgetMarketContext[]): number {
  if (contexts.length === 0) {
    return 0;
  }
  const checks = contexts.flatMap((context) => [
    Boolean(context.openInterest),
    context.fundingRates.length > 0,
    context.takerBuySell.length > 0,
    context.longShort.length > 0,
    context.accountLongShort.length > 0,
    context.positionLongShort.length > 0
  ]);
  const covered = checks.filter(Boolean).length;
  return roundPct((covered / checks.length) * 100);
}

function timestampSpanPct(points: Array<{ timestampMs: number }>, requiredMs: number): number {
  if (points.length < 2 || requiredMs <= 0) {
    return 0;
  }
  const timestamps = points.map((point) => point.timestampMs);
  const spanMs = Math.max(...timestamps) - Math.min(...timestamps);
  return Math.min(100, (spanMs / requiredMs) * 100);
}

export function calculateBitgetFeatureTimeCoverage(contexts: BitgetMarketContext[], days: number): number {
  if (contexts.length === 0 || days <= 0) {
    return 0;
  }
  const requiredMs = days * 24 * 60 * 60 * 1000;
  const coverageParts = contexts.flatMap((context) => [
    0,
    timestampSpanPct(context.fundingRates, requiredMs),
    timestampSpanPct(context.takerBuySell, requiredMs),
    timestampSpanPct(context.longShort, requiredMs),
    timestampSpanPct(context.accountLongShort, requiredMs),
    timestampSpanPct(context.positionLongShort, requiredMs)
  ]);
  const average = coverageParts.reduce((sum, value) => sum + value, 0) / coverageParts.length;
  return roundPct(average);
}

export function buildDataOnlyBitgetVolumeMetrics(contexts: BitgetMarketContext[], options: { days?: number } = {}): BitgetVolumeResearchMetrics {
  return {
    trades: 0,
    returnPct: 0,
    maxDrawdownPct: 0,
    profitFactor: 0,
    featureCoveragePct: options.days ? calculateBitgetFeatureTimeCoverage(contexts, options.days) : calculateBitgetFeatureCoverage(contexts),
    walkForwardPasses: 0,
    walkForwardWindows: 0
  };
}

function evidence(metrics: BitgetVolumeResearchMetrics): string {
  return [
    `trades=${metrics.trades}`,
    `maxDrawdownPct=${metrics.maxDrawdownPct}`,
    `walkForward=${metrics.walkForwardPasses}/${metrics.walkForwardWindows}`,
    `featureCoveragePct=${metrics.featureCoveragePct}`
  ].join(" ");
}

function noTrade(metrics: BitgetVolumeResearchMetrics, blocked: string, nextCheck: string): BitgetVolumeResearchGrade {
  return {
    action: "hold",
    rawScore: 0,
    state: "no_trade",
    blocked,
    evidence: evidence(metrics),
    nextCheck
  };
}

export function gradeBitgetVolumeResearch(metrics: BitgetVolumeResearchMetrics): BitgetVolumeResearchGrade {
  if (metrics.featureCoveragePct < 80) {
    return noTrade(metrics, `blocked=data_missing featureCoveragePct=${metrics.featureCoveragePct}`, "collect true Bitget market-context data");
  }

  if (metrics.trades === 0) {
    return noTrade(metrics, "blocked=research_only_no_strategy_trades", "build walk-forward feature study before any entry rule");
  }

  if (metrics.returnPct <= 0 || metrics.profitFactor < 1.15) {
    return noTrade(
      metrics,
      `blocked=negative_expectancy returnPct=${metrics.returnPct} profitFactor=${metrics.profitFactor}`,
      "replace hypothesis; do not tune leverage"
    );
  }

  if (metrics.trades < 80) {
    return noTrade(metrics, `blocked=sample_too_small trades=${metrics.trades}`, "collect broader symbol/time evidence");
  }

  if (metrics.maxDrawdownPct > 20) {
    return noTrade(metrics, `blocked=drawdown_too_high maxDrawdownPct=${metrics.maxDrawdownPct}`, "reduce risk or reject hypothesis");
  }

  if (metrics.walkForwardWindows === 0 || metrics.walkForwardPasses / metrics.walkForwardWindows < 0.6) {
    return noTrade(
      metrics,
      `blocked=walk_forward_failed passes=${metrics.walkForwardPasses}/${metrics.walkForwardWindows}`,
      "inspect regime sensitivity"
    );
  }

  return {
    action: "hold",
    rawScore: 70,
    state: "observe_only",
    blocked: "blocked=paper_evidence_missing",
    evidence: evidence(metrics),
    nextCheck: "run 2-4 weeks paper before sim_ready"
  };
}

export function buildBitgetVolumeResearchReport(options: {
  days: number;
  symbols: string[];
  metrics: BitgetVolumeResearchMetrics;
  generatedAt?: string;
}): BitgetVolumeResearchReport {
  return {
    exchange: "bitget",
    productType: "USDT-FUTURES",
    days: options.days,
    symbols: options.symbols,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    metrics: options.metrics,
    ...gradeBitgetVolumeResearch(options.metrics)
  };
}
