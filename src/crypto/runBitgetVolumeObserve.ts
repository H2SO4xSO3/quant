import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBitgetVolumeObservationReports, type BitgetVolumeObservationReport, type StoredBitgetMarketContext } from "./bitgetVolumeObservation";

export interface BitgetVolumeObserveArgs {
  input: string;
  output?: string;
  minHours: number;
  minRawScore: number;
}

export interface BitgetVolumeObserveRunReport {
  generatedAt: string;
  input: string;
  minHours: number;
  minRawScore: number;
  reports: BitgetVolumeObservationReport[];
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function numberArg(args: string[], name: string, fallback: number): number {
  const parsed = Number(readArg(args, name));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseBitgetVolumeObserveArgs(args: string[]): BitgetVolumeObserveArgs {
  return {
    input: readArg(args, "--input") ?? "data/bitget-volume-history/market-contexts.jsonl",
    output: readArg(args, "--output"),
    minHours: numberArg(args, "--min-hours", 168),
    minRawScore: numberArg(args, "--min-raw-score", 70)
  };
}

export function readStoredBitgetMarketContexts(input: string): StoredBitgetMarketContext[] {
  const raw = readFileSync(input, "utf8").trim();
  if (!raw) {
    return [];
  }
  return raw.split(/\n/).filter(Boolean).map((line) => JSON.parse(line) as StoredBitgetMarketContext);
}

export async function runBitgetVolumeObserve(args = process.argv.slice(2)): Promise<BitgetVolumeObservationReport[]> {
  const options = parseBitgetVolumeObserveArgs(args);
  const reports = buildBitgetVolumeObservationReports({
    contexts: readStoredBitgetMarketContexts(options.input),
    minHours: options.minHours,
    minRawScore: options.minRawScore
  });
  const runReport: BitgetVolumeObserveRunReport = {
    generatedAt: new Date().toISOString(),
    input: options.input,
    minHours: options.minHours,
    minRawScore: options.minRawScore,
    reports
  };

  if (options.output) {
    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, `${JSON.stringify(runReport, null, 2)}\n`, "utf8");
    console.log(`Bitget volume observe report written: ${options.output}`);
  }

  for (const report of reports) {
    console.log(
      `symbol=${report.symbol} action=${report.action} rawScore=${report.rawScore.toFixed(1)} state=${report.state} blocked=${report.blocked}`
    );
  }
  return reports;
}

const executedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (executedPath) {
  runBitgetVolumeObserve().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
