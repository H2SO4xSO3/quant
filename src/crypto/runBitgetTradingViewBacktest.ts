import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchBitgetHistoryCandles } from "./bitgetClient";
import { computeFramaChannelSeries, computeRangeFilterSeries, runColorGatedSignalBacktest, runFlipSignalBacktest, runRangePreTriggerBacktest, runRiskRewardSignalBacktest } from "./tradingViewIndicators";

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function timeFromEnv(name: string): number | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

const symbol = process.env.BITGET_SYMBOL ?? "MUUSDT";
const productType = process.env.BITGET_PRODUCT_TYPE ?? "USDT-FUTURES";
const granularity = process.env.BITGET_GRANULARITY ?? "1m";
const days = numberFromEnv("BITGET_BACKTEST_DAYS", Number(process.argv[2] ?? 14));
const warmupDays = numberFromEnv("BITGET_WARMUP_DAYS", 3);
const marginUsdt = numberFromEnv("BITGET_MARGIN_USDT", 100);
const leverage = numberFromEnv("BITGET_LEVERAGE", 25);
const feeRate = numberFromEnv("BITGET_FEE_RATE", 0.0006);
const maintenanceMarginRate = numberFromEnv("BITGET_MAINTENANCE_MARGIN_RATE", 0.005);
const minTradeMarginUsdt = numberFromEnv("BITGET_MIN_TRADE_MARGIN_USDT", 1);
const maxHoldBars = numberFromEnv("BITGET_MAX_HOLD_BARS", 0);
const usePreTrigger = process.env.BITGET_PRE_TRIGGER === "1";
const preTriggerStopTrigger = process.env.BITGET_PRE_TRIGGER_STOP_TRIGGER === "close" ? "close" : "wick";
const useFramaExit = process.env.BITGET_FRAMA_EXIT === "1";
const useFramaColorGate = process.env.BITGET_FRAMA_COLOR_GATE === "1";
const riskRewardRatio = numberFromEnv("BITGET_RISK_REWARD_RATIO", 0);
const outputPath = process.env.BITGET_BACKTEST_REPORT_PATH ?? "data/bitget-muusdt-range-filter-14d-report.json";

const endTime = timeFromEnv("BITGET_BACKTEST_END_TIME") ?? Date.now();
const startTime = timeFromEnv("BITGET_BACKTEST_START_TIME") ?? endTime - days * 24 * 60 * 60 * 1000;
const warmupStartTime = startTime - warmupDays * 24 * 60 * 60 * 1000;

const rows = await fetchBitgetHistoryCandles({
  symbol,
  productType,
  granularity,
  startTime: warmupStartTime,
  endTime
});
const range = computeRangeFilterSeries(rows, { samplingPeriod: 100, rangeMultiplier: 3 });
const frama = computeFramaChannelSeries(rows, { length: 26, bandsDistance: 1.5 });
const result = usePreTrigger
  ? runRangePreTriggerBacktest({
      symbol,
      rows,
      range,
      frama,
      marginUsdt,
      leverage,
      feeRate,
      tradeStartTime: startTime,
      maintenanceMarginRate,
      compoundEquity: true,
      minTradeMarginUsdt,
      stopTrigger: preTriggerStopTrigger
    })
  : riskRewardRatio > 0
  ? runRiskRewardSignalBacktest({
      symbol,
      rows,
      signals: range.map((point) => point.signal),
      riskRewardRatio,
      marginUsdt,
      leverage,
      feeRate,
      tradeStartTime: startTime,
      maintenanceMarginRate,
      compoundEquity: true,
      minTradeMarginUsdt
    })
  : useFramaColorGate
  ? runColorGatedSignalBacktest({
      symbol,
      rows,
      signals: range.map((point) => point.signal),
      framaColors: frama.map((point) => point.candleColor),
      marginUsdt,
      leverage,
      feeRate,
      tradeStartTime: startTime,
      maintenanceMarginRate,
      compoundEquity: true,
      minTradeMarginUsdt
    })
  : runFlipSignalBacktest({
      symbol,
      rows,
      signals: range.map((point) => point.signal),
      framaExitBands: useFramaExit ? frama.map((point) => ({ upper: point.upper, lower: point.lower })) : undefined,
      marginUsdt,
      leverage,
      feeRate,
      tradeStartTime: startTime,
      maintenanceMarginRate,
      compoundEquity: true,
      minTradeMarginUsdt,
      maxHoldBars: maxHoldBars > 0 ? maxHoldBars : undefined
    });

const signals = range
  .map((point, index) => ({ point, row: rows[index], frama: frama[index] }))
  .filter((entry) => entry.row.openTime >= startTime && entry.point.signal)
  .map((entry) => ({
    time: new Date(entry.row.openTime).toISOString(),
    signal: entry.point.signal,
    close: entry.row.close,
    rangeFilter: entry.point.filter,
    frama: entry.frama.frama,
    framaUpper: entry.frama.upper,
    framaLower: entry.frama.lower
  }));

const report = {
  generatedAt: new Date().toISOString(),
  exchange: "bitget",
  productType,
  symbol,
  granularity,
  days,
  warmupDays,
  warmupStartTime: new Date(warmupStartTime).toISOString(),
  startTime: new Date(startTime).toISOString(),
  endTime: new Date(endTime).toISOString(),
  warmupCandles: rows.filter((row) => row.openTime < startTime).length,
  candles: rows.filter((row) => row.openTime >= startTime).length,
  sourceCandles: rows.length,
  settings: {
    rangeFilter: { source: "close", samplingPeriod: 100, rangeMultiplier: 3 },
    framaChannel: { length: 26, bandsDistance: 1.5, signalsData: "Price", exitOnChannelPullback: useFramaExit, colorGate: useFramaColorGate },
    execution: { initialEquityUsdt: marginUsdt, marginMode: "all_in_compounded", leverage, initialNotionalUsdt: marginUsdt * leverage, feeRate, maintenanceMarginRate, minTradeMarginUsdt, preTrigger: usePreTrigger || undefined, preTriggerStopTrigger: usePreTrigger ? preTriggerStopTrigger : undefined, maxHoldBars: maxHoldBars > 0 ? maxHoldBars : undefined, riskRewardRatio: riskRewardRatio > 0 ? riskRewardRatio : undefined }
  },
  signals: {
    count: signals.length,
    buys: signals.filter((signal) => signal.signal === "buy").length,
    sells: signals.filter((signal) => signal.signal === "sell").length,
    recent: signals.slice(-20)
  },
  result,
  note: usePreTrigger
    ? "Backtest uses Bitget 1m candles, previous Range Filter bands as pre-trigger entry levels, FRAMA/Range middle lines for stops, FRAMA outer bands for take profit, all-in 100U starting equity at 25x, fees and liquidation modeled. Historical backtest is biased evidence, not live readiness."
    : "Backtest uses Bitget 1m candles, Range Filter labels for entries/reversals, all-in 100U starting equity at 25x, FRAMA values for context only, fees and liquidation modeled. Historical backtest is biased evidence, not live readiness."
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
