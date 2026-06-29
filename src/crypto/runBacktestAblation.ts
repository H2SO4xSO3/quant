import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BinanceClient } from "./binanceClient";
import { runBacktest, type BacktestResult, type BacktestTrade } from "./backtest";
import { loadCryptoBotConfig } from "./config";
import { buildSpotAblationCandidates, type SpotAblationCandidate } from "./spotAblation";
import { buildTradeAttributionReport } from "./tradeAttribution";

interface AblationSummary {
  id: string;
  label: string;
  strategyId: string;
  symbols: string[];
  notes: string[];
  trade_count: number;
  win_rate: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  expectancy: number;
  profit_factor: number;
  max_drawdown: number;
  median_holding_minutes: number;
  worst_symbols: string[];
  best_symbols: string[];
}

interface AblationResult {
  generatedAt: string;
  days: number;
  sourceLimit: string;
  summaries: AblationSummary[];
  results: Array<{ candidate: SpotAblationCandidate; backtest: BacktestResult }>;
}

function flattenTrades(result: BacktestResult): BacktestTrade[] {
  return result.symbols.flatMap((symbol) => symbol.trades);
}

function summarize(candidate: SpotAblationCandidate, result: BacktestResult): AblationSummary {
  const attribution = buildTradeAttributionReport(flattenTrades(result));
  return {
    id: candidate.id,
    label: candidate.label,
    strategyId: candidate.strategyId,
    symbols: candidate.symbols,
    notes: candidate.notes,
    trade_count: attribution.totals.tradeCount,
    win_rate: attribution.totals.winRatePct,
    avg_win_pct: attribution.totals.avgWinPct,
    avg_loss_pct: attribution.totals.avgLossPct,
    expectancy: attribution.totals.expectancyPct,
    profit_factor: attribution.totals.profitFactor,
    max_drawdown: attribution.totals.maxDrawdownUsdt,
    median_holding_minutes: attribution.totals.medianHoldingMinutes,
    worst_symbols: attribution.worstSymbols,
    best_symbols: attribution.bestSymbols
  };
}

function formatSummary(summaries: AblationSummary[]): string {
  return [
    "# Spot Backtest Ablation",
    "",
    ...summaries.map((item) => [
      `## ${item.id} ${item.label}`,
      `trade_count=${item.trade_count} win_rate=${item.win_rate}% avg_win_pct=${item.avg_win_pct}% avg_loss_pct=${item.avg_loss_pct}%`,
      `expectancy=${item.expectancy}% profit_factor=${item.profit_factor} max_drawdown=${item.max_drawdown}U median_holding=${item.median_holding_minutes}m`,
      `best_symbols=${item.best_symbols.join(" | ") || "none"}`,
      `worst_symbols=${item.worst_symbols.join(" | ") || "none"}`,
      `notes=${item.notes.join(" ")}`,
      ""
    ].join("\n"))
  ].join("\n");
}

const config = loadCryptoBotConfig();
const days = Number(process.argv[2] ?? 14);
const outputPath = path.resolve(process.cwd(), process.argv[3] ?? `data/backtest-ablation-${days}d.json`);
const client = new BinanceClient({ baseUrl: config.baseUrl });
const candidates = buildSpotAblationCandidates({
  baseStrategyId: config.strategyId,
  baseConfig: config.strategy,
  symbols: config.symbols
});

try {
  const results: AblationResult["results"] = [];
  for (const candidate of candidates) {
    const backtest = await runBacktest({
      client,
      symbols: candidate.symbols,
      days,
      initialCapitalUsdt: config.backtestInitialCapitalUsdt,
      maxOpenPositions: config.risk.maxOpenPositions,
      orderQuoteQty: config.risk.maxOrderUsdt,
      strategy: candidate.strategy,
      signalStrategy: candidate.signalStrategy
    });
    results.push({ candidate, backtest });
  }
  const report: AblationResult = {
    generatedAt: new Date().toISOString(),
    days,
    sourceLimit: "Uses Binance spot historical klines for requested days. If Binance/cache lacks rows, the per-symbol candle counts in results are the real limit.",
    summaries: results.map((item) => summarize(item.candidate, item.backtest)),
    results
  };
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(formatSummary(report.summaries));
  console.log(`Saved JSON: ${outputPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
