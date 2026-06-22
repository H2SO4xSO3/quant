import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadCryptoBotConfig } from "./config";
import {
  AlternativeFearGreedClient,
  BinanceFuturesExternalDataClient,
  clampFuturesDays,
  summarizeSymbolExternalData,
  type FuturesPeriod,
  type FuturesSymbolExternalData,
  type SymbolExternalSummary
} from "./externalData";

const REPORT_PATH = path.resolve(process.cwd(), "data/external/free-market-context.json");
const SUPPORTED_PERIODS = new Set<FuturesPeriod>(["5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"]);

interface FreeExternalMarketContextReport {
  generatedAt: string;
  days: number;
  period: FuturesPeriod;
  sources: {
    binanceFutures: string;
    fearGreed: string;
  };
  limitations: string[];
  fearGreed: Awaited<ReturnType<AlternativeFearGreedClient["fetchFearGreed"]>>;
  futures: Record<string, FuturesSymbolExternalData>;
  summaries: SymbolExternalSummary[];
}

async function main(): Promise<void> {
  const config = loadCryptoBotConfig();
  const days = clampFuturesDays(Number(process.argv[2] ?? 30));
  const period = parsePeriod(process.argv[3] ?? "15m");
  const fearGreedClient = new AlternativeFearGreedClient();
  const futuresClient = new BinanceFuturesExternalDataClient();

  console.log(`Fetching free external data: days=${days}, period=${period}, symbols=${config.symbols.join(",")}`);
  const [fearGreed, futures] = await Promise.all([fetchFearGreed(fearGreedClient), fetchFuturesData(futuresClient, config.symbols, days, period)]);
  const summaries = Object.entries(futures)
    .map(([symbol, data]) => summarizeSymbolExternalData(symbol, data))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const report: FreeExternalMarketContextReport = {
    generatedAt: new Date().toISOString(),
    days,
    period,
    sources: {
      binanceFutures: "https://fapi.binance.com",
      fearGreed: "https://api.alternative.me/fng/"
    },
    limitations: [
      "Binance futures sentiment endpoints expose only the most recent 30 days.",
      "Fear and Greed Index is daily market context, not a 5m entry trigger.",
      "This file is data collection only; live trading rules are not changed by this command."
    ],
    fearGreed,
    futures,
    summaries
  };

  writeReport(report);
  printSummary(report);
}

async function fetchFearGreed(client: AlternativeFearGreedClient) {
  try {
    return await client.fetchFearGreed(0);
  } catch (error) {
    console.warn(`Fear and Greed fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function fetchFuturesData(
  client: BinanceFuturesExternalDataClient,
  symbols: string[],
  days: number,
  period: FuturesPeriod
): Promise<Record<string, FuturesSymbolExternalData>> {
  const result: Record<string, FuturesSymbolExternalData> = {};
  for (const symbol of symbols) {
    try {
      result[symbol] = await client.fetchSymbolData(symbol, { days, period });
      const summary = summarizeSymbolExternalData(symbol, result[symbol]);
      console.log(
        `${symbol}: bias=${summary.bias}, OI 1h=${formatPct(summary.openInterestChange1hPct)}, taker=${formatNumber(summary.takerBuySellRatio)}, funding=${formatPct(summary.fundingRatePct)}`
      );
    } catch (error) {
      console.warn(`Futures external data fetch failed for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      result[symbol] = {
        openInterest: [],
        takerBuySell: [],
        globalLongShortAccountRatio: [],
        topLongShortAccountRatio: [],
        topLongShortPositionRatio: [],
        fundingRates: []
      };
    }
  }
  return result;
}

function writeReport(report: FreeExternalMarketContextReport): void {
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function printSummary(report: FreeExternalMarketContextReport): void {
  const latestFearGreed = report.fearGreed.at(-1);
  console.log(`External data report written: ${REPORT_PATH}`);
  if (latestFearGreed) {
    console.log(`Fear & Greed latest: ${latestFearGreed.value} ${latestFearGreed.classification} (${new Date(latestFearGreed.timestamp).toISOString()})`);
  }
  console.table(
    report.summaries.map((summary) => ({
      symbol: summary.symbol,
      bias: summary.bias,
      oi1h: formatPct(summary.openInterestChange1hPct),
      oi4h: formatPct(summary.openInterestChange4hPct),
      taker: formatNumber(summary.takerBuySellRatio),
      globalLS: formatNumber(summary.globalLongShortRatio),
      topPosLS: formatNumber(summary.topTraderPositionLongShortRatio),
      funding: formatPct(summary.fundingRatePct),
      warnings: summary.warnings.length
    }))
  );
}

function parsePeriod(value: string): FuturesPeriod {
  if (SUPPORTED_PERIODS.has(value as FuturesPeriod)) {
    return value as FuturesPeriod;
  }
  throw new Error(`Unsupported period ${value}. Use one of: ${Array.from(SUPPORTED_PERIODS).join(", ")}`);
}

function formatPct(value: number | undefined): string {
  return value === undefined ? "n/a" : `${value.toFixed(3)}%`;
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? "n/a" : value.toFixed(3);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
