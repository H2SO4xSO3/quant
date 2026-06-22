import { existsSync, readFileSync } from "node:fs";
import type { BacktestGuardConfig } from "./types";

interface BacktestReportShape {
  current?: {
    generatedAt?: string;
    symbols?: Array<{
      symbol?: string;
      trades?: unknown[];
      netPnlUsdt?: number;
      profitFactor?: number;
    }>;
    totals?: {
      trades?: number;
      netPnlUsdt?: number;
      profitFactor?: number;
    };
  };
}

export interface BacktestGuardDecision {
  allowed: boolean;
  reasons: string[];
}

export function evaluateBacktestGuard(config: BacktestGuardConfig, now = new Date(), symbol?: string): BacktestGuardDecision {
  if (!config.enabled) {
    return { allowed: true, reasons: [] };
  }

  if (!existsSync(config.reportPath)) {
    return { allowed: false, reasons: [`Backtest guard is on but ${config.reportPath} does not exist`] };
  }

  let report: BacktestReportShape;
  try {
    report = JSON.parse(readFileSync(config.reportPath, "utf8")) as BacktestReportShape;
  } catch {
    return { allowed: false, reasons: ["Backtest guard could not parse the latest backtest report"] };
  }

  const generatedAt = report.current?.generatedAt ? Date.parse(report.current.generatedAt) : NaN;
  const totals = report.current?.totals;
  const reasons: string[] = [];
  if (!Number.isFinite(generatedAt)) {
    reasons.push("Backtest report is missing a valid generatedAt timestamp");
  } else {
    const ageHours = (now.getTime() - generatedAt) / 3_600_000;
    if (ageHours > config.maxAgeHours) {
      reasons.push(`Backtest report is ${ageHours.toFixed(1)}h old, above the ${config.maxAgeHours}h limit`);
    }
  }

  const checkPortfolio = !symbol || !config.requireSymbolHealth;
  if (checkPortfolio) {
    const trades = Number(totals?.trades ?? 0);
    const netPnlUsdt = Number(totals?.netPnlUsdt ?? Number.NEGATIVE_INFINITY);
    const profitFactor = Number(totals?.profitFactor ?? 0);
    if (trades < config.minTrades) {
      reasons.push(`Backtest has only ${trades} trades, below the ${config.minTrades} minimum`);
    }
    if (netPnlUsdt <= config.minNetPnlUsdt) {
      reasons.push(`Backtest net PnL ${netPnlUsdt.toFixed(4)}U is not above ${config.minNetPnlUsdt}U`);
    }
    if (profitFactor < config.minProfitFactor) {
      reasons.push(`Backtest profit factor ${profitFactor.toFixed(3)} is below ${config.minProfitFactor}`);
    }
  }

  if (symbol && config.requireSymbolHealth) {
    const symbolReport = report.current?.symbols?.find((item) => item.symbol === symbol);
    if (!symbolReport) {
      reasons.push(`Backtest report has no per-symbol result for ${symbol}`);
    } else {
      const symbolTrades = Array.isArray(symbolReport.trades) ? symbolReport.trades.length : 0;
      const symbolNetPnlUsdt = Number(symbolReport.netPnlUsdt ?? Number.NEGATIVE_INFINITY);
      const symbolProfitFactor = Number(symbolReport.profitFactor ?? 0);
      if (symbolTrades < config.minSymbolTrades) {
        reasons.push(`${symbol} backtest has only ${symbolTrades} trades, below the ${config.minSymbolTrades} symbol minimum`);
      }
      if (symbolNetPnlUsdt <= config.minSymbolNetPnlUsdt) {
        reasons.push(`${symbol} backtest net PnL ${symbolNetPnlUsdt.toFixed(4)}U is not above ${config.minSymbolNetPnlUsdt}U`);
      }
      if (symbolProfitFactor < config.minSymbolProfitFactor) {
        reasons.push(`${symbol} backtest profit factor ${symbolProfitFactor.toFixed(3)} is below ${config.minSymbolProfitFactor}`);
      }
    }
  }

  return { allowed: reasons.length === 0, reasons };
}
