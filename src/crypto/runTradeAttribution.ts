import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BacktestResult, BacktestTrade } from "./backtest";
import { buildTradeAttributionReport, formatTradeAttributionReport, type AttributionTrade } from "./tradeAttribution";
import type { CryptoJournalEntry } from "./types";

interface BacktestReportFile {
  current?: BacktestResult;
  guarded?: BacktestResult;
  optimized?: { best?: BacktestResult; candidates?: BacktestResult[] };
}

interface JournalFile {
  entries?: CryptoJournalEntry[];
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJson<T>(filePath: string): T {
  if (!existsSync(filePath)) {
    throw new Error(`${filePath} does not exist`);
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function tradesFromBacktest(filePath: string, section: "current" | "guarded" | "optimized-best"): BacktestTrade[] {
  const report = readJson<BacktestReportFile>(filePath);
  const selected = section === "optimized-best" ? report.optimized?.best : report[section];
  return selected?.symbols.flatMap((symbol) => symbol.trades) ?? [];
}

function exitTypeFromNotes(entry: CryptoJournalEntry): AttributionTrade["exitType"] {
  const note = entry.notes?.[0] ?? "";
  if (note.includes("stop_loss")) return "stop_loss";
  if (note.includes("take_profit")) return "take_profit";
  if (note.includes("trailing_stop")) return "trailing_stop";
  if (note.includes("timeout")) return "timeout";
  if (note.includes("signal_exit")) return "signal_exit";
  return "manual_or_unknown";
}

function tradesFromPaper(filePath: string): AttributionTrade[] {
  const journal = readJson<JournalFile>(filePath);
  return (journal.entries ?? [])
    .filter((entry) => entry.side === "SELL")
    .map((entry) => ({
      symbol: entry.symbol,
      entryTime: entry.entryTime ?? entry.timestamp,
      exitTime: entry.exitTime ?? entry.timestamp,
      entryPrice: entry.entryPrice ?? entry.price ?? 0,
      exitPrice: entry.exitPrice ?? entry.price ?? 0,
      entryQuoteQty: entry.quoteQty ?? 0,
      pnlUsdt: entry.pnlUsdt ?? entry.realizedPnlUsdt ?? 0,
      pnlPct: entry.pnlPct,
      holdingMinutes: entry.holdingMinutes,
      reason: entry.exitType ?? exitTypeFromNotes(entry),
      exitType: entry.exitType ?? exitTypeFromNotes(entry),
      rsiAtEntry: entry.rsiAtEntry,
      priceVsVwapPctAtEntry: entry.priceVsVwapPctAtEntry,
      emaFastSlopeAtEntry: entry.emaFastSlopeAtEntry,
      spreadPctAtEntry: entry.spreadPctAtEntry,
      estimatedSlippagePct: entry.estimatedSlippagePct,
      btcTrendAtEntry: entry.btcTrendAtEntry,
      maxFavorableExcursionPct: entry.maxFavorableExcursionPct,
      maxAdverseExcursionPct: entry.maxAdverseExcursionPct
    }));
}

const backtestPath = path.resolve(process.cwd(), argValue("--backtest") ?? "data/backtest-report.json");
const paperPath = argValue("--paper") ? path.resolve(process.cwd(), argValue("--paper")!) : undefined;
const section = (argValue("--section") ?? "current") as "current" | "guarded" | "optimized-best";
const outputPath = path.resolve(process.cwd(), argValue("--output") ?? "data/trade-attribution-report.json");

try {
  const trades = paperPath ? tradesFromPaper(paperPath) : tradesFromBacktest(backtestPath, section);
  const report = buildTradeAttributionReport(trades);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(formatTradeAttributionReport(report));
  console.log(`Saved JSON: ${outputPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
