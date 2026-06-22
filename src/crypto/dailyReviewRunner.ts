import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildDailyStrategyReview,
  formatDailyStrategyReview,
  type DailyReviewSourceInput,
  type DailyStrategyReview
} from "./dailyReview";
import type { CryptoJournalEntry } from "./types";

export interface DailyReviewRunnerOptions {
  cwd?: string;
  now?: Date;
  windowHours?: number;
  initialCapitalUsdt: number;
  outputDir?: string;
  timeZone?: string;
}

export interface DailyReviewRunnerResult {
  review: DailyStrategyReview;
  latestMarkdownPath: string;
  latestJsonPath: string;
  datedMarkdownPath: string;
  datedJsonPath: string;
}

interface DefaultSourceSpec {
  id: string;
  label: string;
  mode: DailyReviewSourceInput["mode"];
  journalPath: string;
}

const DEFAULT_SOURCES: DefaultSourceSpec[] = [
  {
    id: "futures-opportunity-50x",
    label: "futures long-or-short opportunity 50x",
    mode: "futures_paper",
    journalPath: "data/futures-opportunity-50x-journal.json"
  },
  {
    id: "video-ema-structure-50x",
    label: "video 1h structure + 5m EMA/RSI 50x",
    mode: "futures_paper",
    journalPath: "data/video-ema-structure-50x-journal.json"
  }
];

function readEntries(filePath: string): CryptoJournalEntry[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    return (JSON.parse(readFileSync(filePath, "utf8")) as { entries?: CryptoJournalEntry[] }).entries ?? [];
  } catch {
    return [];
  }
}

function datedStem(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function loadDefaultDailyReviewSources(cwd: string, initialCapitalUsdt: number): DailyReviewSourceInput[] {
  return DEFAULT_SOURCES.map((source) => ({
    id: source.id,
    label: source.label,
    mode: source.mode,
    initialCapitalUsdt,
    entries: readEntries(path.resolve(cwd, source.journalPath))
  }));
}

export function runDailyReviewFromFiles(options: DailyReviewRunnerOptions): DailyReviewRunnerResult {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  const outputDir = path.resolve(cwd, options.outputDir ?? "data/reviews");
  const review = buildDailyStrategyReview(loadDefaultDailyReviewSources(cwd, options.initialCapitalUsdt), {
    now,
    windowHours: options.windowHours ?? 24
  });
  const markdown = formatDailyStrategyReview(review);
  const json = `${JSON.stringify(review, null, 2)}\n`;
  const date = datedStem(now, options.timeZone ?? "Asia/Shanghai");
  const latestMarkdownPath = path.join(outputDir, "daily-review-latest.md");
  const latestJsonPath = path.join(outputDir, "daily-review-latest.json");
  const datedMarkdownPath = path.join(outputDir, `daily-review-${date}.md`);
  const datedJsonPath = path.join(outputDir, `daily-review-${date}.json`);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(latestMarkdownPath, markdown, "utf8");
  writeFileSync(latestJsonPath, json, "utf8");
  writeFileSync(datedMarkdownPath, markdown, "utf8");
  writeFileSync(datedJsonPath, json, "utf8");

  return { review, latestMarkdownPath, latestJsonPath, datedMarkdownPath, datedJsonPath };
}
