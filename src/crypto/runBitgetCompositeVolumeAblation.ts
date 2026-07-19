import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCandidateLedger,
  buildVariantSummaries,
  extractRouterCandidates,
  gradeCompositeVolumeAblation,
  labelCandidateOutcomes,
  type CompositeVolumeAblationGrade,
  type CompositeVolumeVariantSummary,
  type VolumeContextSnapshot
} from "./bitgetCompositeVolumeAblation";
import { fetchBitgetKlinesForInterval } from "./bitgetBacktest";
import { buildBitgetVolumeObservationReportForRows, type StoredBitgetMarketContext } from "./bitgetVolumeObservation";
import { loadCryptoBotConfig } from "./config";
import { backtestFuturesSymbolFromRows, type FuturesSignalObservation } from "./futuresBacktest";
import { bitgetCompositeRouterStrategy } from "./strategies/bitgetCompositeRouter";
import type { BinanceKline } from "./types";

type ResearchInterval = "5m" | "15m" | "1h";

export interface CompositeVolumeAblationArgs {
  input: string;
  outputDir: string;
  candleCacheDir: string;
}

export interface BitgetCompositeVolumeAblationReport {
  generatedAt: string;
  source: {
    input: string;
    sha256: string;
    totalRows: number;
    validRows: number;
    invalidRows: number;
    firstTimestamp: string | null;
    lastTimestamp: string | null;
  };
  assumptions: {
    minHistoryHours: number;
    candidateCooldownMinutes: number;
    maxContextAgeMinutes: number;
    horizonsMinutes: number[];
    roundTripCostsPct: number[];
  };
  volumeSnapshots: number;
  routerObservations: number;
  candidates: number;
  blockerCounts: Record<"volume_score_filter" | "crowding_flow_veto", Record<string, number>>;
  candleCoverage: Array<{ symbol: string; interval: ResearchInterval; bars: number; first: string | null; last: string | null }>;
  summaries: CompositeVolumeVariantSummary[];
  grade: CompositeVolumeAblationGrade;
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function parseStoredContextJsonl(raw: string): {
  contexts: StoredBitgetMarketContext[];
  totalRows: number;
  invalidRows: number;
} {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const contexts: StoredBitgetMarketContext[] = [];
  let invalidRows = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as StoredBitgetMarketContext;
      if (!parsed.timestampReceived || !parsed.symbol) {
        invalidRows += 1;
      } else {
        contexts.push(parsed);
      }
    } catch {
      invalidRows += 1;
    }
  }
  return { contexts, totalRows: lines.length, invalidRows };
}

export function parseCompositeVolumeAblationArgs(args: string[]): CompositeVolumeAblationArgs {
  const outputDir = readArg(args, "--output-dir") ?? "data/bitget-composite-volume-ablation";
  return {
    input: readArg(args, "--input") ?? `${outputDir}/market-contexts.jsonl`,
    outputDir,
    candleCacheDir: readArg(args, "--candle-cache-dir") ?? outputDir
  };
}

function groupContexts(contexts: StoredBitgetMarketContext[]): Map<string, StoredBitgetMarketContext[]> {
  const grouped = new Map<string, StoredBitgetMarketContext[]>();
  for (const context of contexts) {
    const symbol = context.symbol.toUpperCase();
    const rows = grouped.get(symbol);
    if (rows) {
      rows.push({ ...context, symbol });
    } else {
      grouped.set(symbol, [{ ...context, symbol }]);
    }
  }
  for (const rows of grouped.values()) {
    rows.sort((left, right) => Date.parse(left.timestampReceived) - Date.parse(right.timestampReceived));
  }
  return grouped;
}

export function reconstructVolumeContextSnapshots(
  contexts: StoredBitgetMarketContext[],
  minHistoryHours = 168
): VolumeContextSnapshot[] {
  const snapshots: VolumeContextSnapshot[] = [];
  for (const rows of groupContexts(contexts).values()) {
    const firstMs = Date.parse(rows[0]?.timestampReceived ?? "");
    for (let index = 0; index < rows.length; index += 1) {
      const timestampMs = Date.parse(rows[index].timestampReceived);
      if (!Number.isFinite(firstMs) || !Number.isFinite(timestampMs) || timestampMs - firstMs < minHistoryHours * 3_600_000) {
        continue;
      }
      const report = buildBitgetVolumeObservationReportForRows(rows, { endIndex: index, minHours: minHistoryHours, minRawScore: 0 });
      if (!report) {
        continue;
      }
      snapshots.push({
        symbol: report.symbol,
        timestampMs,
        rawScore: report.rawScore,
        direction: report.direction,
        openInterest24hPct: report.evidence.openInterest24hPct,
        openInterest12hPct: report.evidence.openInterest12hPct,
        takerWindowImbalancePct: report.evidence.takerWindowImbalancePct,
        longShortRatio: report.evidence.longShortRatio,
        accountLongShortRatio: report.evidence.accountLongShortRatio,
        positionLongShortRatio: report.evidence.positionLongShortRatio,
        latestFundingRatePct: report.evidence.latestFundingRatePct
      });
    }
  }
  return snapshots.sort((left, right) => left.timestampMs - right.timestampMs || left.symbol.localeCompare(right.symbol));
}

function display(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4);
}

export function renderChineseCompositeVolumeAblationReport(report: BitgetCompositeVolumeAblationReport): string {
  const rows = report.summaries.map(
    (summary) =>
      `| ${summary.variant} | ${summary.horizonMinutes} | ${summary.roundTripCostPct.toFixed(2)} | ${summary.acceptedCandidates}/${summary.totalCandidates} | ${summary.summary.completed} | ${display(summary.summary.meanNetReturnPct)} | ${display(summary.summary.winRatePct)} | ${display(summary.paired.meanDeltaPct)} | ${
        summary.paired.meanDeltaCi95Pct ? summary.paired.meanDeltaCi95Pct.map((value) => value.toFixed(4)).join(" ~ ") : "n/a"
      } |`
  );
  const blockerLines = (["volume_score_filter", "crowding_flow_veto"] as const).map((variant) => {
    const counts = Object.entries(report.blockerCounts[variant])
      .sort((left, right) => right[1] - left[1])
      .map(([reason, count]) => `${reason}:${count}`)
      .join(", ");
    return `- ${variant}: ${counts || "none"}`;
  });

  return [
    "# Bitget组合路由器成交量配对消融",
    "",
    `生成时间：${report.generatedAt}`,
    `数据：${report.source.validRows}/${report.source.totalRows}条有效，异常${report.source.invalidRows}条`,
    `区间：${report.source.firstTimestamp ?? "n/a"} 至 ${report.source.lastTimestamp ?? "n/a"}`,
    `路由器候选：${report.candidates}，成交量快照：${report.volumeSnapshots}`,
    "",
    "## 研究结论",
    "",
    `action=${report.grade.action}`,
    `rawScore=${report.grade.rawScore.toFixed(1)}`,
    `state=${report.grade.state}`,
    `blocked=${report.grade.blocked}`,
    `evidence=${report.grade.evidence}`,
    `next_check=${report.grade.nextCheck}`,
    "",
    "## 阻断分布",
    "",
    ...blockerLines,
    "",
    "## 配对结果",
    "",
    "| 变体 | 周期分钟 | 往返成本% | 接受/全部候选 | 完成 | 接受候选净均值% | 胜率% | 配对均值差% | 配对均值差95%区间 |",
    "| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |",
    ...(rows.length ? rows : ["| n/a | 0 | 0 | 0/0 | 0 | n/a | n/a | n/a | n/a |"]),
    "",
    "说明：成交量层只过滤原路由器候选，不制造或反向生成交易；该报告不连接模拟或实盘执行。",
    ""
  ].join("\n");
}

function cachePath(cacheDir: string, symbol: string, interval: ResearchInterval): string {
  return path.join(cacheDir, `candles-${symbol}-${interval}.json`);
}

export function cachedCandlesCoverRange(
  rows: BinanceKline[],
  startTime: number,
  endTime: number,
  interval: ResearchInterval
): boolean {
  const intervalMs = interval === "5m" ? 300_000 : interval === "15m" ? 900_000 : 3_600_000;
  const firstOpen = Number(rows[0]?.[0]);
  const lastOpen = Number(rows.at(-1)?.[0]);
  return (
    Number.isFinite(firstOpen) &&
    Number.isFinite(lastOpen) &&
    firstOpen <= startTime + intervalMs &&
    lastOpen >= endTime - intervalMs
  );
}

async function loadCandles(options: {
  cacheDir: string;
  symbol: string;
  interval: ResearchInterval;
  startTime: number;
  endTime: number;
}): Promise<BinanceKline[]> {
  const file = cachePath(options.cacheDir, options.symbol, options.interval);
  if (existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, "utf8")) as BinanceKline[];
    if (cachedCandlesCoverRange(cached, options.startTime, options.endTime, options.interval)) {
      return cached;
    }
  }
  const rows = await fetchBitgetKlinesForInterval({
    symbol: options.symbol,
    productType: "USDT-FUTURES",
    interval: options.interval,
    startTime: options.startTime,
    endTime: options.endTime
  });
  mkdirSync(options.cacheDir, { recursive: true });
  writeFileSync(file, JSON.stringify(rows));
  return rows;
}

function blockerCounts(
  ledger: ReturnType<typeof buildCandidateLedger>
): BitgetCompositeVolumeAblationReport["blockerCounts"] {
  const result: BitgetCompositeVolumeAblationReport["blockerCounts"] = {
    volume_score_filter: {},
    crowding_flow_veto: {}
  };
  for (const row of ledger) {
    for (const variant of ["volume_score_filter", "crowding_flow_veto"] as const) {
      const blocker = row.decisions[variant].blocked;
      if (!blocker) {
        continue;
      }
      const key = blocker.split(" ")[0];
      result[variant][key] = (result[variant][key] ?? 0) + 1;
    }
  }
  return result;
}

function latestRawScore(snapshots: VolumeContextSnapshot[]): number {
  const latest = new Map<string, VolumeContextSnapshot>();
  for (const snapshot of snapshots) {
    const current = latest.get(snapshot.symbol);
    if (!current || snapshot.timestampMs > current.timestampMs) {
      latest.set(snapshot.symbol, snapshot);
    }
  }
  return Math.max(0, ...[...latest.values()].map((snapshot) => snapshot.rawScore));
}

export async function runBitgetCompositeVolumeAblation(args: CompositeVolumeAblationArgs): Promise<BitgetCompositeVolumeAblationReport> {
  const raw = readFileSync(args.input, "utf8");
  const parsed = parseStoredContextJsonl(raw);
  const contexts = parsed.contexts.sort(
    (left, right) => Date.parse(left.timestampReceived) - Date.parse(right.timestampReceived) || left.symbol.localeCompare(right.symbol)
  );
  const firstTimestamp = contexts[0]?.timestampReceived ?? null;
  const lastTimestamp = contexts.at(-1)?.timestampReceived ?? null;
  if (!firstTimestamp || !lastTimestamp) {
    throw new Error("No valid Bitget market contexts found");
  }

  const minHistoryHours = 168;
  const candidateCooldownMinutes = 1_440;
  const maxContextAgeMinutes = 15;
  const horizonsMinutes = [60, 240, 720, 1_440];
  const roundTripCostsPct = [0.2, 0.3];
  const snapshots = reconstructVolumeContextSnapshots(contexts, minHistoryHours);
  if (snapshots.length === 0) {
    throw new Error("No volume snapshots passed the minimum history gate");
  }

  const symbols = [...new Set(contexts.map((context) => context.symbol.toUpperCase()))].sort();
  const firstSnapshotMs = snapshots[0].timestampMs;
  const lastContextMs = Date.parse(lastTimestamp);
  const candleStartMs = Date.parse(firstTimestamp) - 7 * 24 * 60 * 60 * 1000;
  const candleEndMs = Math.min(Date.now(), lastContextMs + Math.max(...horizonsMinutes) * 60_000);
  const candleMap = new Map<string, BinanceKline[]>();
  const candleCoverage: BitgetCompositeVolumeAblationReport["candleCoverage"] = [];

  for (const symbol of [...new Set([...symbols, "BTCUSDT"])]) {
    for (const interval of ["5m", "15m", "1h"] as const) {
      const rows = await loadCandles({ cacheDir: args.candleCacheDir, symbol, interval, startTime: candleStartMs, endTime: candleEndMs });
      candleMap.set(`${symbol}:${interval}`, rows);
      candleCoverage.push({
        symbol,
        interval,
        bars: rows.length,
        first: rows[0] ? new Date(Number(rows[0][0])).toISOString() : null,
        last: rows.at(-1) ? new Date(Number(rows.at(-1)![0])).toISOString() : null
      });
    }
  }

  const config = loadCryptoBotConfig();
  const observations: FuturesSignalObservation[] = [];
  for (const symbol of symbols) {
    backtestFuturesSymbolFromRows({
      symbol,
      raw5m: candleMap.get(`${symbol}:5m`) ?? [],
      raw15m: candleMap.get(`${symbol}:15m`) ?? [],
      rawHourly: candleMap.get(`${symbol}:1h`) ?? [],
      rawBenchmark5m: symbol === "BTCUSDT" ? undefined : candleMap.get("BTCUSDT:5m"),
      rawBenchmark15m: symbol === "BTCUSDT" ? undefined : candleMap.get("BTCUSDT:15m"),
      marginUsdt: 20,
      strategyConfig: config.strategy,
      signalStrategy: bitgetCompositeRouterStrategy,
      futuresConfig: {
        leverage: 5,
        feeRate: 0.0006,
        estimatedSlippagePct: config.strategy.estimatedSlippagePct,
        priceImpactPct: config.strategy.priceImpactPct,
        maintenanceMarginRate: 0.005
      },
      observeSignal: (observation) => observations.push(observation)
    });
  }

  const eligibleObservations = observations.filter(
    (observation) => observation.openTime >= firstSnapshotMs && observation.openTime <= lastContextMs
  );
  const candidates = extractRouterCandidates(eligibleObservations, candidateCooldownMinutes);
  const ledger = buildCandidateLedger({ candidates, volumeSnapshots: snapshots, maxContextAgeMinutes });
  const bars = symbols.flatMap((symbol) =>
    (candleMap.get(`${symbol}:5m`) ?? []).map((row) => ({
      symbol,
      openTimeMs: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4])
    }))
  );
  const outcomes = labelCandidateOutcomes({ ledger, bars, horizonsMinutes, roundTripCostsPct });
  const summaries = buildVariantSummaries({ ledger, outcomes, horizonsMinutes, roundTripCostsPct });
  const grade = gradeCompositeVolumeAblation({ latestRawScore: latestRawScore(snapshots), summaries });

  const report: BitgetCompositeVolumeAblationReport = {
    generatedAt: new Date().toISOString(),
    source: {
      input: args.input,
      sha256: createHash("sha256").update(raw).digest("hex"),
      totalRows: parsed.totalRows,
      validRows: parsed.contexts.length,
      invalidRows: parsed.invalidRows,
      firstTimestamp,
      lastTimestamp
    },
    assumptions: { minHistoryHours, candidateCooldownMinutes, maxContextAgeMinutes, horizonsMinutes, roundTripCostsPct },
    volumeSnapshots: snapshots.length,
    routerObservations: eligibleObservations.length,
    candidates: candidates.length,
    blockerCounts: blockerCounts(ledger),
    candleCoverage,
    summaries,
    grade
  };

  mkdirSync(args.outputDir, { recursive: true });
  const outcomesByCandidate = new Map<string, typeof outcomes>();
  for (const outcome of outcomes) {
    outcomesByCandidate.set(outcome.candidateId, [...(outcomesByCandidate.get(outcome.candidateId) ?? []), outcome]);
  }
  writeFileSync(
    path.join(args.outputDir, "candidate-ledger.jsonl"),
    ledger.map((row) => JSON.stringify({ ...row, outcomes: outcomesByCandidate.get(row.id) ?? [] })).join("\n") + (ledger.length ? "\n" : "")
  );
  writeFileSync(path.join(args.outputDir, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(args.outputDir, "report-zh.md"), renderChineseCompositeVolumeAblationReport(report));
  return report;
}

async function main(): Promise<void> {
  const report = await runBitgetCompositeVolumeAblation(parseCompositeVolumeAblationArgs(process.argv.slice(2)));
  console.log(
    `action=${report.grade.action} rawScore=${report.grade.rawScore.toFixed(1)} state=${report.grade.state} blocked=${report.grade.blocked} evidence=${report.grade.evidence} next_check=${report.grade.nextCheck}`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
