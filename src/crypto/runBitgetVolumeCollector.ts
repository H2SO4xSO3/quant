import { fileURLToPath } from "node:url";
import { BitgetVolumeCollector } from "./bitgetVolumeCollector";
import { JsonlBitgetVolumeStore } from "./bitgetVolumeStore";

export interface BitgetVolumeCollectorArgs {
  symbols: string[];
  period: string;
  productType: string;
  dataDir: string;
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

function parseSymbols(value: string): string[] {
  return value
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}

export function parseBitgetVolumeCollectorArgs(args: string[]): BitgetVolumeCollectorArgs {
  return {
    symbols: parseSymbols(readArg(args, "--symbols") ?? "BTCUSDT,XRPUSDT"),
    period: readArg(args, "--period") ?? "5m",
    productType: readArg(args, "--product-type") ?? "USDT-FUTURES",
    dataDir: readArg(args, "--data-dir") ?? "data/bitget-volume-history"
  };
}

export async function runBitgetVolumeCollector(args = process.argv.slice(2)) {
  const options = parseBitgetVolumeCollectorArgs(args);
  const collector = new BitgetVolumeCollector({
    symbols: options.symbols,
    period: options.period,
    productType: options.productType,
    store: new JsonlBitgetVolumeStore(options.dataDir)
  });
  const summary = await collector.collectOnce();
  console.log(`Bitget volume collector wrote ${summary.contexts}/${summary.symbols} contexts to ${options.dataDir}`);
  console.log(`blockers=${summary.blockers} errors=${summary.errors}`);
  return summary;
}

const executedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (executedPath) {
  runBitgetVolumeCollector().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
