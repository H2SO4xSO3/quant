import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadCryptoBotConfig } from "./config";
import {
  AlternativeFearGreedClient,
  BinanceFuturesExternalDataClient,
  clampFuturesDays,
  type FuturesPeriod,
  type FuturesSymbolExternalData
} from "./externalData";
import { mergeExternalMarketHistory, type FreeExternalMarketContextReport } from "./externalHistory";

const HISTORY_PATH = path.resolve(process.cwd(), "data/external/free-market-history.json");
const SUPPORTED_PERIODS = new Set<FuturesPeriod>(["5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"]);

async function main(): Promise<void> {
  const config = loadCryptoBotConfig();
  const days = clampFuturesDays(Number(process.argv[2] ?? 29));
  const period = parsePeriod(process.argv[3] ?? "15m");
  const existing = readExistingHistory();
  const fresh = await fetchFreshContext(config.symbols, days, period);
  const merged = mergeExternalMarketHistory(existing, fresh);

  mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  writeFileSync(HISTORY_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log(`External market history written: ${HISTORY_PATH}`);
  console.log(`fearGreed=${merged.fearGreed.length}, symbols=${Object.keys(merged.futures).length}`);
  console.table(
    merged.summaries.map((summary) => ({
      symbol: summary.symbol,
      bias: summary.bias,
      oi: merged.futures[summary.symbol]?.openInterest.length ?? 0,
      taker: merged.futures[summary.symbol]?.takerBuySell.length ?? 0,
      funding: merged.futures[summary.symbol]?.fundingRates.length ?? 0,
      warnings: summary.warnings.length
    }))
  );
}

async function fetchFreshContext(symbols: string[], days: number, period: FuturesPeriod): Promise<FreeExternalMarketContextReport> {
  const fearGreedClient = new AlternativeFearGreedClient();
  const futuresClient = new BinanceFuturesExternalDataClient();
  const [fearGreed, futures] = await Promise.all([fetchFearGreed(fearGreedClient), fetchFuturesData(futuresClient, symbols, days, period)]);

  return {
    generatedAt: new Date().toISOString(),
    days,
    period,
    sources: {
      binanceFutures: "https://fapi.binance.com",
      fearGreed: "https://api.alternative.me/fng/"
    },
    limitations: [
      "Binance futures sentiment endpoints expose only the most recent 30 days per request.",
      "This history file grows only while the collector runs; it cannot reconstruct unavailable older futures sentiment."
    ],
    fearGreed,
    futures,
    summaries: []
  };
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
      console.log(`${symbol}: collected external points`);
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

function readExistingHistory(): FreeExternalMarketContextReport | undefined {
  if (!existsSync(HISTORY_PATH)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(HISTORY_PATH, "utf8")) as FreeExternalMarketContextReport;
  } catch (error) {
    console.warn(`Existing external history is unreadable and will be replaced: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function parsePeriod(value: string): FuturesPeriod {
  if (SUPPORTED_PERIODS.has(value as FuturesPeriod)) {
    return value as FuturesPeriod;
  }
  throw new Error(`Unsupported period ${value}. Use one of: ${Array.from(SUPPORTED_PERIODS).join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
