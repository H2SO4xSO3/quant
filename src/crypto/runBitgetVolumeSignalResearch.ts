import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBitgetKlinesForInterval } from "./bitgetBacktest";
import { buildBitgetVolumeObservationReports, type StoredBitgetMarketContext } from "./bitgetVolumeObservation";
import type {
  LabeledEventSummary,
  ReturnSampleComparison,
  ScoreObservation,
  VolumeSignalResearchGrade,
  VolumeWatchDirection
} from "./bitgetVolumeSignalResearch";
import {
  buildNonOverlappingBaselineReturns,
  compareReturnSamples,
  extractThresholdCrossings,
  gradeVolumeSignalResearch,
  labelSignalEvents,
  summarizeLabeledEvents,
  type ResearchPriceBar
} from "./bitgetVolumeSignalResearch";

export interface ParsedStoredContextJsonl {
  contexts: StoredBitgetMarketContext[];
  totalRows: number;
  invalidRows: number;
}

export interface VolumeSignalResearchCell {
  sample: "primary" | "diagnostic";
  threshold: number;
  direction: "all" | VolumeWatchDirection;
  horizonMinutes: number;
  cooldownMinutes: number;
  roundTripCostPct: number;
  crossingEvents: number;
  summary: LabeledEventSummary;
  comparison: ReturnSampleComparison;
}

export interface BitgetVolumeSignalResearchReport {
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
    thresholds: number[];
    horizonsMinutes: number[];
    roundTripCostsPct: number[];
    primaryCooldownMinutes: number;
  };
  scoreObservations: number;
  latestScores: Record<string, { rawScore: number; direction: VolumeWatchDirection }>;
  candleCoverage: Array<{ symbol: string; bars: number; first: string | null; last: string | null }>;
  crossingCounts: Record<string, number>;
  cells: VolumeSignalResearchCell[];
  grade: VolumeSignalResearchGrade;
}

export interface VolumeSignalResearchArgs {
  input: string;
  outputDir: string;
  candleCacheDir: string;
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

export function parseVolumeSignalResearchArgs(args: string[]): VolumeSignalResearchArgs {
  const outputDir = readArg(args, "--output-dir") ?? "data/bitget-volume-signal-research";
  return {
    input: readArg(args, "--input") ?? `${outputDir}/market-contexts.jsonl`,
    outputDir,
    candleCacheDir: readArg(args, "--candle-cache-dir") ?? outputDir
  };
}

export function parseStoredContextJsonl(raw: string): ParsedStoredContextJsonl {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const contexts: StoredBitgetMarketContext[] = [];
  let invalidRows = 0;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as StoredBitgetMarketContext;
      if (!parsed.timestampReceived || !parsed.symbol) {
        invalidRows += 1;
        continue;
      }
      contexts.push(parsed);
    } catch {
      invalidRows += 1;
    }
  }

  return { contexts, totalRows: lines.length, invalidRows };
}

function display(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4);
}

export function renderChineseVolumeSignalReport(report: BitgetVolumeSignalResearchReport): string {
  const latestLines = Object.entries(report.latestScores)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([symbol, score]) => `- ${symbol} rawScore=${score.rawScore.toFixed(1)} direction=${score.direction}`);
  const primaryCells = report.cells.filter(
    (cell) => cell.sample === "primary" && cell.roundTripCostPct === 0.2 && cell.direction === "all"
  );
  const primaryRows = primaryCells.map(
    (cell) =>
      `| ${cell.threshold} | ${cell.horizonMinutes} | ${cell.summary.completed} | ${cell.summary.pending} | ${display(
        cell.summary.meanNetReturnPct
      )} | ${display(cell.summary.winRatePct)} | ${display(
        cell.comparison.baselineMeanPct
      )} | ${display(cell.comparison.signalMinusBaselineMeanPct)} | ${
        cell.comparison.excessMeanCi95Pct ? cell.comparison.excessMeanCi95Pct.map((value) => value.toFixed(4)).join(" ~ ") : "n/a"
      } |`
  );
  const diagnosticRows = report.cells
    .filter(
      (cell) =>
        cell.sample === "diagnostic" &&
        cell.threshold === 70 &&
        cell.roundTripCostPct === 0.2 &&
        cell.direction === "all"
    )
    .map(
      (cell) =>
        `| ${cell.horizonMinutes} | ${cell.summary.completed} | ${cell.summary.pending} | ${display(
          cell.summary.meanNetReturnPct
        )} | ${display(cell.summary.winRatePct)} | ${display(cell.comparison.signalMinusBaselineMeanPct)} | ${
          cell.comparison.excessMeanCi95Pct ? cell.comparison.excessMeanCi95Pct.map((value) => value.toFixed(4)).join(" ~ ") : "n/a"
        } |`
    );

  return [
    "# Bitget量价评分事件研究",
    "",
    `生成时间：${report.generatedAt}`,
    `数据：${report.source.validRows}/${report.source.totalRows}条有效，异常${report.source.invalidRows}条`,
    `区间：${report.source.firstTimestamp ?? "n/a"} 至 ${report.source.lastTimestamp ?? "n/a"}`,
    "",
    "## 当前评分",
    "",
    ...latestLines,
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
    "## 主要样本",
    "",
    "24小时冷却、往返成本0.20%。",
    "",
    "| 阈值 | 持有分钟 | 完成 | 待完成 | 信号净均值% | 胜率% | 基准均值% | 超额均值% | 超额均值95%区间 |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |",
    ...(primaryRows.length ? primaryRows : ["| n/a | n/a | 0 | 0 | n/a | n/a | n/a | n/a | n/a |"]),
    "",
    "## 70分诊断样本",
    "",
    "按持有周期冷却、往返成本0.20%；仅用于诊断，不能升级研究状态。",
    "",
    "| 持有分钟 | 完成 | 待完成 | 信号净均值% | 胜率% | 超额均值% | 超额均值95%区间 |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | :--- |",
    ...(diagnosticRows.length ? diagnosticRows : ["| n/a | 0 | 0 | n/a | n/a | n/a | n/a |"]),
    "",
    "说明：未完成未来周期的事件不进入统计；该报告不连接模拟或实盘交易。",
    ""
  ].join("\n");
}

export function reconstructHistoricalScoreObservations(
  contexts: StoredBitgetMarketContext[],
  minHistoryHours = 168
): ScoreObservation[] {
  const grouped = new Map<string, StoredBitgetMarketContext[]>();
  for (const context of contexts) {
    const symbol = context.symbol.toUpperCase();
    grouped.set(symbol, [...(grouped.get(symbol) ?? []), { ...context, symbol }]);
  }

  const observations: ScoreObservation[] = [];
  for (const rows of grouped.values()) {
    rows.sort((left, right) => Date.parse(left.timestampReceived) - Date.parse(right.timestampReceived));
    const firstMs = Date.parse(rows[0]?.timestampReceived ?? "");
    for (let index = 0; index < rows.length; index += 1) {
      const timestampMs = Date.parse(rows[index].timestampReceived);
      if (!Number.isFinite(firstMs) || !Number.isFinite(timestampMs) || timestampMs - firstMs < minHistoryHours * 3_600_000) {
        continue;
      }
      const report = buildBitgetVolumeObservationReports({
        contexts: rows.slice(0, index + 1),
        minHours: minHistoryHours,
        minRawScore: 0
      })[0];
      if (!report) {
        continue;
      }
      observations.push({
        symbol: report.symbol,
        timestampMs,
        direction: report.direction,
        rawScore: report.rawScore
      });
    }
  }

  return observations.sort((left, right) => left.timestampMs - right.timestampMs || left.symbol.localeCompare(right.symbol));
}

export function buildResearchMatrix(options: {
  observations: ScoreObservation[];
  bars: ResearchPriceBar[];
  thresholds: number[];
  horizonsMinutes: number[];
  roundTripCostsPct: number[];
  primaryCooldownMinutes: number;
}): VolumeSignalResearchCell[] {
  const cells: VolumeSignalResearchCell[] = [];
  const directions: Array<"all" | VolumeWatchDirection> = ["all", "long_watch", "short_watch"];
  const firstObservationMs = Math.min(...options.observations.map((row) => row.timestampMs));
  const lastBarMs = Math.max(...options.bars.map((bar) => bar.openTimeMs));

  for (const threshold of options.thresholds) {
    for (const horizonMinutes of options.horizonsMinutes) {
      for (const sample of ["primary", "diagnostic"] as const) {
        const cooldownMinutes = sample === "primary" ? options.primaryCooldownMinutes : horizonMinutes;
        const allEvents = extractThresholdCrossings(options.observations, threshold, cooldownMinutes);
        for (const direction of directions) {
          const events = direction === "all" ? allEvents : allEvents.filter((event) => event.direction === direction);
          for (const roundTripCostPct of options.roundTripCostsPct) {
            const labels = labelSignalEvents({ events, bars: options.bars, horizonMinutes, roundTripCostPct });
            const completedLabels = labels.filter(
              (label): label is typeof label & { netDirectionalReturnPct: number } =>
                label.status === "completed" && label.netDirectionalReturnPct !== undefined
            );
            const signalReturns = completedLabels.map((label) => label.netDirectionalReturnPct);
            const baselineCache = new Map<string, number[]>();
            const baselineReturns = completedLabels.flatMap((label) => {
              const key = `${label.symbol}:${label.direction}`;
              let pool = baselineCache.get(key);
              if (!pool) {
                pool = buildNonOverlappingBaselineReturns({
                  bars: options.bars,
                  symbol: label.symbol,
                  direction: label.direction,
                  horizonMinutes,
                  roundTripCostPct,
                  startTimeMs: firstObservationMs,
                  endTimeMs: lastBarMs
                });
                baselineCache.set(key, pool);
              }
              if (pool.length === 0) {
                return [];
              }
              const deterministicIndex = Math.abs(Math.floor(label.timestampMs / 300_000)) % pool.length;
              return [pool[deterministicIndex]];
            });

            cells.push({
              sample,
              threshold,
              direction,
              horizonMinutes,
              cooldownMinutes,
              roundTripCostPct,
              crossingEvents: events.length,
              summary: summarizeLabeledEvents(labels),
              comparison: compareReturnSamples(signalReturns, baselineReturns)
            });
          }
        }
      }
    }
  }

  return cells;
}

function loadCachedBars(cachePath: string, startTimeMs: number, endTimeMs: number): ResearchPriceBar[] | undefined {
  if (!existsSync(cachePath)) {
    return undefined;
  }
  const rows = JSON.parse(readFileSync(cachePath, "utf8")) as ResearchPriceBar[];
  const ordered = rows.sort((left, right) => left.openTimeMs - right.openTimeMs);
  const first = ordered[0]?.openTimeMs;
  const last = ordered.at(-1)?.openTimeMs;
  if (first === undefined || last === undefined || first > startTimeMs + 300_000 || last < endTimeMs) {
    return undefined;
  }
  return ordered;
}

export function lastClosedFiveMinuteOpenTime(nowMs: number): number {
  return Math.floor(nowMs / 300_000) * 300_000 - 300_000;
}

async function fetchResearchBars(options: {
  symbols: string[];
  startTimeMs: number;
  endTimeMs: number;
  cacheDir: string;
}): Promise<ResearchPriceBar[]> {
  const bars: ResearchPriceBar[] = [];
  mkdirSync(options.cacheDir, { recursive: true });
  for (const symbol of options.symbols) {
    const cachePath = path.join(options.cacheDir, `candles-${symbol}-5m.json`);
    let symbolBars = loadCachedBars(cachePath, options.startTimeMs, options.endTimeMs);
    if (!symbolBars) {
      const rows = await fetchBitgetKlinesForInterval({
        symbol,
        productType: "USDT-FUTURES",
        interval: "5m",
        startTime: options.startTimeMs,
        endTime: options.endTimeMs
      });
      const fetchedBars: ResearchPriceBar[] = rows.map((row) => ({
        symbol,
        openTimeMs: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4])
      }));
      symbolBars = fetchedBars;
      writeFileSync(cachePath, `${JSON.stringify(fetchedBars)}\n`, "utf8");
    }
    if (!symbolBars) {
      throw new Error(`blocked=data_missing no candles for ${symbol}`);
    }
    bars.push(...symbolBars);
  }
  return bars;
}

function latestScores(observations: ScoreObservation[]): Record<string, { rawScore: number; direction: VolumeWatchDirection }> {
  const latest: Record<string, { rawScore: number; direction: VolumeWatchDirection; timestampMs: number }> = {};
  for (const observation of observations) {
    if (!latest[observation.symbol] || observation.timestampMs > latest[observation.symbol].timestampMs) {
      latest[observation.symbol] = {
        rawScore: observation.rawScore,
        direction: observation.direction,
        timestampMs: observation.timestampMs
      };
    }
  }
  return Object.fromEntries(Object.entries(latest).map(([symbol, value]) => [symbol, { rawScore: value.rawScore, direction: value.direction }]));
}

export async function runBitgetVolumeSignalResearch(args = process.argv.slice(2)): Promise<BitgetVolumeSignalResearchReport> {
  const options = parseVolumeSignalResearchArgs(args);
  const raw = readFileSync(options.input, "utf8");
  const parsed = parseStoredContextJsonl(raw);
  if (parsed.contexts.length === 0) {
    throw new Error("blocked=data_missing no valid Bitget market contexts");
  }

  const minHistoryHours = 168;
  const thresholds = [60, 65, 70];
  const horizonsMinutes = [60, 240, 720, 1_440];
  const roundTripCostsPct = [0, 0.12, 0.2, 0.3];
  const primaryCooldownMinutes = 1_440;
  const observations = reconstructHistoricalScoreObservations(parsed.contexts, minHistoryHours);
  if (observations.length === 0) {
    throw new Error("blocked=data_missing no score observations passed 168h warmup");
  }

  const symbols = [...new Set(observations.map((row) => row.symbol))].sort();
  const startTimeMs = Math.min(...observations.map((row) => row.timestampMs)) - 300_000;
  const endTimeMs = lastClosedFiveMinuteOpenTime(Date.now());
  const bars = await fetchResearchBars({ symbols, startTimeMs, endTimeMs, cacheDir: options.candleCacheDir });
  if (bars.length === 0) {
    throw new Error("blocked=data_missing no Bitget 5m candles");
  }

  const cells = buildResearchMatrix({
    observations,
    bars,
    thresholds,
    horizonsMinutes,
    roundTripCostsPct,
    primaryCooldownMinutes
  });
  const latest = latestScores(observations);
  const primaryCells = cells
    .filter((cell) => cell.sample === "primary" && cell.threshold === 70 && cell.direction === "all" && cell.roundTripCostPct === 0.2)
    .map((cell) => ({
      horizonMinutes: cell.horizonMinutes,
      completed: cell.summary.completed,
      signalMinusBaselineMeanPct: cell.comparison.signalMinusBaselineMeanPct,
      excessMeanCi95Pct: cell.comparison.excessMeanCi95Pct
    }));
  const timestamps = parsed.contexts.map((row) => row.timestampReceived).sort();
  const crossingCounts = Object.fromEntries(
    thresholds.flatMap((threshold) => [
      [`threshold=${threshold}:cooldown=1440`, extractThresholdCrossings(observations, threshold, primaryCooldownMinutes).length],
      ...horizonsMinutes.map((horizon) => [
        `threshold=${threshold}:cooldown=${horizon}`,
        extractThresholdCrossings(observations, threshold, horizon).length
      ])
    ])
  );
  const report: BitgetVolumeSignalResearchReport = {
    generatedAt: new Date().toISOString(),
    source: {
      input: options.input,
      sha256: createHash("sha256").update(raw).digest("hex"),
      totalRows: parsed.totalRows,
      validRows: parsed.contexts.length,
      invalidRows: parsed.invalidRows,
      firstTimestamp: timestamps[0] ?? null,
      lastTimestamp: timestamps.at(-1) ?? null
    },
    assumptions: { minHistoryHours, thresholds, horizonsMinutes, roundTripCostsPct, primaryCooldownMinutes },
    scoreObservations: observations.length,
    latestScores: latest,
    candleCoverage: symbols.map((symbol) => {
      const symbolBars = bars.filter((bar) => bar.symbol === symbol).sort((left, right) => left.openTimeMs - right.openTimeMs);
      return {
        symbol,
        bars: symbolBars.length,
        first: symbolBars[0] ? new Date(symbolBars[0].openTimeMs).toISOString() : null,
        last: symbolBars.at(-1) ? new Date(symbolBars.at(-1)!.openTimeMs).toISOString() : null
      };
    }),
    crossingCounts,
    cells,
    grade: gradeVolumeSignalResearch({
      latestRawScores: Object.fromEntries(Object.entries(latest).map(([symbol, score]) => [symbol, score.rawScore])),
      primaryCells
    })
  };

  mkdirSync(options.outputDir, { recursive: true });
  writeFileSync(path.join(options.outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(path.join(options.outputDir, "report-zh.md"), renderChineseVolumeSignalReport(report), "utf8");
  for (const [symbol, score] of Object.entries(report.latestScores)) {
    console.log(
      `symbol=${symbol} action=${report.grade.action} rawScore=${score.rawScore.toFixed(1)} state=${report.grade.state} blocked=${report.grade.blocked}`
    );
  }
  console.log(`evidence=${report.grade.evidence}`);
  console.log(`next_check=${report.grade.nextCheck}`);
  return report;
}

const executedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (executedPath) {
  runBitgetVolumeSignalResearch().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
