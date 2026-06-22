import { loadCryptoBotConfig } from "./config";
import { runDailyReviewFromFiles } from "./dailyReviewRunner";

function parseWindowHours(value: string | undefined): number {
  const parsed = Number(value ?? 24);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

const config = loadCryptoBotConfig();
const result = runDailyReviewFromFiles({
  initialCapitalUsdt: config.backtestInitialCapitalUsdt,
  windowHours: parseWindowHours(process.argv[2]),
  outputDir: process.env.DAILY_REVIEW_OUTPUT_DIR ?? "data/reviews"
});

console.log(JSON.stringify({
  generatedAt: result.review.generatedAt,
  latestMarkdownPath: result.latestMarkdownPath,
  latestJsonPath: result.latestJsonPath,
  closedTrades: result.review.totals.closedTrades,
  netPnlUsdt: result.review.totals.netPnlUsdt,
  findings: result.review.findings,
  hypotheses: result.review.hypotheses
}, null, 2));
