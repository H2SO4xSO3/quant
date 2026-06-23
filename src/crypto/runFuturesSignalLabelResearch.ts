import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchHistoricalKlines } from "./backtest";
import { BinanceClient } from "./binanceClient";
import { loadCryptoBotConfig } from "./config";
import { createFuturesSignalLabelReportFromRows } from "./futuresSignalLabelResearch";

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main(): Promise<void> {
  const days = Number(process.argv[2] ?? 30);
  const config = loadCryptoBotConfig();
  const client = new BinanceClient({ baseUrl: config.baseUrl });
  const symbols = config.symbols;
  const rows = [];
  for (const symbol of symbols) {
    rows.push({ symbol, rows: await fetchHistoricalKlines(client, symbol, "5m", days) });
  }

  const report = createFuturesSignalLabelReportFromRows({
    days,
    symbols: rows,
    horizonBars: numberFromEnv("FUTURES_LABEL_HORIZON_BARS", 12),
    takeProfitPct: numberFromEnv("FUTURES_LABEL_TAKE_PROFIT_PCT", 0.75),
    stopLossPct: numberFromEnv("FUTURES_LABEL_STOP_LOSS_PCT", 0.45),
    costPct:
      numberFromEnv("FUTURES_FEE_RATE", 0.0004) * 2 * 100 +
      numberFromEnv("FUTURES_ESTIMATED_SLIPPAGE_PCT", config.strategy.estimatedSlippagePct) +
      numberFromEnv("FUTURES_PRICE_IMPACT_PCT", config.strategy.priceImpactPct),
    leverage: numberFromEnv("FUTURES_PAPER_LEVERAGE", 50)
  });

  const outputPath = process.env.FUTURES_LABEL_RESEARCH_PATH ?? "data/futures-signal-label-research.json";
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Futures signal label research ${days}d complete: screenedBars=${report.screenedBars}, baselineTrades=${report.baseline.trades}`);
  console.log(
    `baseline win=${(report.baseline.winRate * 100).toFixed(2)}%, net=${report.baseline.netPnlPct.toFixed(4)}%, marginNet=${report.baseline.marginNetPnlPct.toFixed(2)}%`
  );
  console.table(
    report.buckets.slice(0, 10).map((bucket) => ({
      name: bucket.name,
      dir: bucket.direction,
      trades: bucket.trades,
      win: Number((bucket.winRate * 100).toFixed(2)),
      net: Number(bucket.netPnlPct.toFixed(4)),
      marginNet: Number(bucket.marginNetPnlPct.toFixed(2)),
      pf: Number(bucket.profitFactor.toFixed(3)),
      dd: Number(bucket.maxDrawdownPct.toFixed(3))
    }))
  );
  console.log(`Report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
