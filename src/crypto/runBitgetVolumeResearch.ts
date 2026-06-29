import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectBitgetMarketContext, type BitgetMarketContext } from "./bitgetMarketData";
import { buildDataOnlyBitgetVolumeMetrics, buildBitgetVolumeResearchReport, type BitgetVolumeResearchReport } from "./bitgetVolumeResearch";

export interface BitgetVolumeResearchArgs {
  days: number;
  symbols: string[];
  period: string;
  output: string;
}

export interface BitgetVolumeResearchRunReport extends BitgetVolumeResearchReport {
  period: string;
  marketContexts: BitgetMarketContext[];
  dataBoundary: {
    openInterest: "current_only";
    funding: "history";
    tradingInsights: "period_rows";
    strategyTrades: "not_generated";
  };
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

export function parseBitgetVolumeResearchArgs(args: string[]): BitgetVolumeResearchArgs {
  const days = Number(readArg(args, "--days") ?? 365);
  const symbols = (readArg(args, "--symbols") ?? "BTCUSDT,XRPUSDT")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const period = readArg(args, "--period") ?? "5m";
  const output = readArg(args, "--output") ?? `data/bitget-volume-research-${days}d.json`;

  return { days, symbols, period, output };
}

export function buildBitgetVolumeResearchRunReport(options: {
  days: number;
  symbols: string[];
  period: string;
  contexts: BitgetMarketContext[];
}): BitgetVolumeResearchRunReport {
  return {
    ...buildBitgetVolumeResearchReport({
      days: options.days,
      symbols: options.symbols,
      metrics: buildDataOnlyBitgetVolumeMetrics(options.contexts, { days: options.days })
    }),
    period: options.period,
    marketContexts: options.contexts,
    dataBoundary: {
      openInterest: "current_only",
      funding: "history",
      tradingInsights: "period_rows",
      strategyTrades: "not_generated"
    }
  };
}

export async function runBitgetVolumeResearch(args = process.argv.slice(2)): Promise<BitgetVolumeResearchRunReport> {
  const options = parseBitgetVolumeResearchArgs(args);
  const contexts: BitgetMarketContext[] = [];
  for (const symbol of options.symbols) {
    contexts.push(
      await collectBitgetMarketContext({
        symbol,
        productType: "USDT-FUTURES",
        period: options.period
      })
    );
  }
  const report = buildBitgetVolumeResearchRunReport({
    days: options.days,
    symbols: options.symbols,
    period: options.period,
    contexts
  });

  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Bitget volume research report written: ${options.output}`);
  console.log(`state=${report.state}`);
  console.log(report.blocked);
  return report;
}

const executedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (executedPath) {
  runBitgetVolumeResearch().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
