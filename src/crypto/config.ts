import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AiReviewConfig, BacktestGuardConfig, CryptoRiskConfig, CryptoStrategyConfig } from "./types";

export interface CryptoBotConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  strategyId: string;
  symbols: string[];
  pollMs: number;
  exitPollMs: number;
  dashboardPort: number;
  backtestInitialCapitalUsdt: number;
  risk: CryptoRiskConfig;
  exitRisk: CryptoRiskConfig;
  strategy: CryptoStrategyConfig;
  aiReview: AiReviewConfig;
  backtestGuard: BacktestGuardConfig;
  autoStartBuyLoop: boolean;
  autoStartExitGuardian: boolean;
}

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    result[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return result;
}

function mergedEnv(envFilePath = path.resolve(process.cwd(), ".env"), env = process.env): Record<string, string | undefined> {
  const fileEnv = existsSync(envFilePath) ? parseEnvFile(readFileSync(envFilePath, "utf8")) : {};
  return { ...fileEnv, ...env };
}

function asNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

export function loadCryptoBotConfig(envFilePath?: string): CryptoBotConfig {
  const env = mergedEnv(envFilePath);
  const symbols = (env.CRYPTO_SYMBOLS ?? "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const maxOrderUsdt = asNumber(env.MAX_ORDER_USDT, 10);
  const dailyMaxLossUsdt = asNumber(env.DAILY_MAX_LOSS_USDT, 3);
  const maxPositionLossUsdt = asNumber(env.MAX_POSITION_LOSS_USDT, 3);

  return {
    apiKey: env.BINANCE_API_KEY ?? "",
    apiSecret: env.BINANCE_API_SECRET ?? "",
    baseUrl: env.BINANCE_BASE_URL ?? "https://api.binance.com",
    strategyId: env.STRATEGY_ID ?? "ema-vwap-trend",
    symbols,
    pollMs: asNumber(env.CRYPTO_POLL_MS, 30_000),
    exitPollMs: asNumber(env.CRYPTO_EXIT_POLL_MS, 15_000),
    dashboardPort: asNumber(env.DASHBOARD_PORT, 8790),
    backtestInitialCapitalUsdt: asNumber(env.BACKTEST_INITIAL_CAPITAL_USDT, 100),
    risk: {
      liveTrading: asBoolean(env.LIVE_TRADING),
      maxOrderUsdt,
      dailyMaxLossUsdt,
      maxPositionLossUsdt,
      maxOpenPositions: asNumber(env.MAX_OPEN_POSITIONS, 1)
    },
    exitRisk: {
      liveTrading: asBoolean(env.LIVE_EXIT_TRADING),
      maxOrderUsdt,
      dailyMaxLossUsdt,
      maxPositionLossUsdt,
      maxOpenPositions: asNumber(env.MAX_OPEN_POSITIONS, 1)
    },
    strategy: {
      minBuyScore: asNumber(env.MIN_BUY_SCORE, 94),
      emaFastPeriod: asNumber(env.EMA_FAST_PERIOD, 9),
      emaSlowPeriod: asNumber(env.EMA_SLOW_PERIOD, 21),
      emaTrendPeriod: asNumber(env.EMA_TREND_PERIOD, 50),
      higherEmaFastPeriod: asNumber(env.HIGHER_EMA_FAST_PERIOD, 20),
      higherEmaSlowPeriod: asNumber(env.HIGHER_EMA_SLOW_PERIOD, 50),
      rsiPeriod: asNumber(env.RSI_PERIOD, 14),
      atrPeriod: asNumber(env.ATR_PERIOD, 14),
      atrStopMultiplier: asNumber(env.ATR_STOP_MULTIPLIER, 2.4),
      takeProfitRiskMultiple: asNumber(env.TAKE_PROFIT_R, 2.4),
      minPriceVwapPct: asNumber(env.MIN_PRICE_VWAP_PCT, 0.15),
      maxPriceVwapPct: asNumber(env.MAX_PRICE_VWAP_PCT, 3),
      minEmaFastSlopePct: asNumber(env.MIN_EMA_FAST_SLOPE_PCT, 0.04),
      minHigherTrendGapPct: asNumber(env.MIN_HIGHER_TREND_GAP_PCT, 0.05),
      minTakeProfitPct: asNumber(env.MIN_TAKE_PROFIT_PCT, 0.55),
      minExpectedValuePct: asNumber(env.MIN_EXPECTED_VALUE_PCT, 0.08),
      estimatedSlippagePct: asNumber(env.ESTIMATED_SLIPPAGE_PCT, 0.03),
      priceImpactPct: asNumber(env.PRICE_IMPACT_PCT, 0.04),
      maxSpreadPct: asNumber(env.MAX_SPREAD_PCT, 0.18),
      entryCooldownMinutes: asNumber(env.ENTRY_COOLDOWN_MINUTES, 180),
      breakevenTriggerPct: asNumber(env.BREAKEVEN_TRIGGER_PCT, 0.45),
      trailingStopTriggerPct: asNumber(env.TRAILING_STOP_TRIGGER_PCT, 0.75),
      trailingStopGivebackPct: asNumber(env.TRAILING_STOP_GIVEBACK_PCT, 0.35),
      signalExitScore: asNumber(env.SIGNAL_EXIT_SCORE, 42),
      maxHoldingMinutes: asNumber(env.MAX_HOLDING_MINUTES, 60),
      maxPositionLossUsdt,
      feeRate: asNumber(env.FEE_RATE, 0.001)
    },
    aiReview: {
      enabled: asBoolean(env.AI_REVIEW_ENABLED),
      apiKey: env.DEEPSEEK_API_KEY ?? env.AI_REVIEW_API_KEY ?? "",
      baseUrl: env.AI_REVIEW_BASE_URL ?? "https://api.deepseek.com",
      model: env.AI_REVIEW_MODEL ?? "deepseek-v4-pro",
      timeoutMs: asNumber(env.AI_REVIEW_TIMEOUT_MS, 8000)
    },
    backtestGuard: {
      enabled: (env.BACKTEST_GUARD_ENABLED ?? "true").toLowerCase() !== "false",
      reportPath: env.BACKTEST_REPORT_PATH ?? path.resolve(process.cwd(), "data/backtest-report.json"),
      minNetPnlUsdt: asNumber(env.BACKTEST_MIN_NET_PNL_USDT, 0),
      minProfitFactor: asNumber(env.BACKTEST_MIN_PROFIT_FACTOR, 1),
      minTrades: asNumber(env.BACKTEST_MIN_TRADES, 5),
      maxAgeHours: asNumber(env.BACKTEST_MAX_AGE_HOURS, 36),
      requireSymbolHealth: (env.BACKTEST_REQUIRE_SYMBOL_HEALTH ?? "true").toLowerCase() !== "false",
      minSymbolNetPnlUsdt: asNumber(env.BACKTEST_MIN_SYMBOL_NET_PNL_USDT, 0),
      minSymbolProfitFactor: asNumber(env.BACKTEST_MIN_SYMBOL_PROFIT_FACTOR, 1),
      minSymbolTrades: asNumber(env.BACKTEST_MIN_SYMBOL_TRADES, 3)
    },
    autoStartBuyLoop: asBoolean(env.AUTO_START_BUY_LOOP),
    autoStartExitGuardian: asBoolean(env.AUTO_START_EXIT_GUARDIAN)
  };
}
