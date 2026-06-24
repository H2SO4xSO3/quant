import { existsSync, readFileSync } from "node:fs";
import type { CryptoStrategy } from "./strategyTypes";
import type { CryptoSignal } from "./types";

type GateDirection = "long" | "short";

interface LabelBucketShape {
  name?: string;
  direction?: "long" | "short" | "both";
  trades?: number;
  netPnlPct?: number;
  profitFactor?: number;
}

interface LabelReportShape {
  generatedAt?: string;
  buckets?: LabelBucketShape[];
}

export interface FuturesSignalLabelGateConfig {
  enabled: boolean;
  reportPath: string;
  minTrades?: number;
  minNetPnlPct?: number;
  minProfitFactor?: number;
  maxAgeHours?: number;
}

export interface FuturesSignalLabelGateDecision {
  allowed: boolean;
  reasons: string[];
}

export function evaluateFuturesSignalLabelGate(reportPath: string, signal: CryptoSignal, config: Partial<FuturesSignalLabelGateConfig> = {}): FuturesSignalLabelGateDecision {
  const direction = signalDirection(signal);
  if (!direction) {
    return { allowed: true, reasons: [] };
  }

  if (!existsSync(reportPath)) {
    return { allowed: false, reasons: [`Label gate blocked ${signal.action}: ${reportPath} does not exist`] };
  }

  let report: LabelReportShape;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8")) as LabelReportShape;
  } catch {
    return { allowed: false, reasons: [`Label gate blocked ${signal.action}: could not parse ${reportPath}`] };
  }

  const maxAgeHours = config.maxAgeHours ?? 72;
  const generatedAt = report.generatedAt ? Date.parse(report.generatedAt) : NaN;
  if (!Number.isFinite(generatedAt)) {
    return { allowed: false, reasons: [`Label gate blocked ${signal.action}: report has no valid generatedAt`] };
  }
  const ageHours = (Date.now() - generatedAt) / 3_600_000;
  if (ageHours > maxAgeHours) {
    return { allowed: false, reasons: [`Label gate blocked ${signal.action}: report is ${ageHours.toFixed(1)}h old, above ${maxAgeHours}h limit`] };
  }

  const minTrades = config.minTrades ?? 30;
  const minNetPnlPct = config.minNetPnlPct ?? 0;
  const minProfitFactor = config.minProfitFactor ?? 1;
  const buckets = (report.buckets ?? []).filter((bucket) => bucket.direction === direction);
  const passing = buckets.find((bucket) => Number(bucket.trades ?? 0) >= minTrades && Number(bucket.netPnlPct ?? Number.NEGATIVE_INFINITY) > minNetPnlPct && Number(bucket.profitFactor ?? 0) >= minProfitFactor);
  if (passing) {
    return { allowed: true, reasons: [`Label gate allowed ${signal.action}: ${passing.name ?? direction} cleared recent research evidence`] };
  }

  const best = buckets
    .map((bucket) => ({
      name: bucket.name ?? direction,
      trades: Number(bucket.trades ?? 0),
      netPnlPct: Number(bucket.netPnlPct ?? Number.NEGATIVE_INFINITY),
      profitFactor: Number(bucket.profitFactor ?? 0)
    }))
    .sort((a, b) => b.netPnlPct - a.netPnlPct)[0];
  const detail = best
    ? `best ${direction} bucket ${best.name}: trades=${best.trades}, net=${best.netPnlPct.toFixed(4)}%, pf=${best.profitFactor.toFixed(3)}`
    : `no ${direction} buckets in report`;
  return {
    allowed: false,
    reasons: [`Label gate blocked ${signal.action}: no profitable ${direction} bucket with trades>=${minTrades}, net>${minNetPnlPct}%, pf>=${minProfitFactor}; ${detail}`]
  };
}

export function wrapStrategyWithFuturesSignalLabelGate(strategy: CryptoStrategy, config: FuturesSignalLabelGateConfig): CryptoStrategy {
  if (!config.enabled) {
    return strategy;
  }
  return {
    id: strategy.id,
    label: `${strategy.label} + label gate`,
    generateSignal: (input) => {
      const signal = strategy.generateSignal(input);
      const decision = evaluateFuturesSignalLabelGate(config.reportPath, signal, config);
      if (decision.allowed) {
        return decision.reasons.length > 0 ? { ...signal, reasons: [...signal.reasons, ...decision.reasons] } : signal;
      }
      return {
        ...signal,
        action: "hold",
        reasons: [...signal.reasons, ...decision.reasons]
      };
    }
  };
}

function signalDirection(signal: CryptoSignal): GateDirection | undefined {
  if (signal.action === "buy") {
    return "long";
  }
  if (signal.action === "sell") {
    return "short";
  }
  return undefined;
}
