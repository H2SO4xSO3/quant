import type { ParsedKline } from "./types";
import type { FlipDirection, FramaCandleColor, TradingViewSignal } from "./tradingViewIndicators";

export type ResearchExitReason = "take_profit" | "stop_loss" | "reverse" | "end" | "day_end" | "liquidation";

export interface FixedRiskTrade {
  symbol: string;
  direction: FlipDirection;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  takeProfitPrice: number;
  riskUsdt: number;
  notionalUsdt: number;
  quantity: number;
  grossPnlUsdt: number;
  feeUsdt: number;
  pnlUsdt: number;
  equityAfterUsdt: number;
  exitReason: ResearchExitReason;
}

export interface DailyResult {
  day: string;
  startEquityUsdt: number;
  endEquityUsdt: number;
  pnlUsdt: number;
  returnPct: number;
  trades: number;
}

export interface FixedRiskBacktestResult {
  symbol: string;
  candles: number;
  trades: FixedRiskTrade[];
  netPnlUsdt: number;
  endingEquityUsdt: number;
  returnPct: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  maxDrawdownUsdt: number;
  daily: DailyResult[];
  avgDailyReturnPct: number;
  minDailyReturnPct: number;
}

export interface FixedRiskBacktestOptions {
  symbol: string;
  rows: ParsedKline[];
  signals: readonly (TradingViewSignal | undefined)[];
  framaColors?: readonly (FramaCandleColor | undefined)[];
  colorGate?: "none" | "withTrend";
  initialEquityUsdt: number;
  riskFraction: number;
  riskRewardRatio: number;
  maxLeverage: number;
  feeRate: number;
  tradeStartTime?: number;
  stopMode?: "wick" | "percent";
  stopPct?: number;
  minStopPct?: number;
  maxStopPct?: number;
  cooldownBars?: number;
  allowReverse?: boolean;
  maintenanceMarginRate?: number;
  dailyProfitTargetPct?: number;
  dailyLossLimitPct?: number;
  forceFlatAtDayEnd?: boolean;
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const dayKeyCache = new Map<number, string>();

function dayKey(openTime: number): string {
  const dayNumber = Math.floor((openTime + SHANGHAI_OFFSET_MS) / DAY_MS);
  const cached = dayKeyCache.get(dayNumber);
  if (cached) {
    return cached;
  }
  const key = new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
  dayKeyCache.set(dayNumber, key);
  return key;
}

function directionForSignal(signal: TradingViewSignal | undefined): FlipDirection | undefined {
  return signal === "buy" ? "long" : signal === "sell" ? "short" : undefined;
}

function colorAllows(colorGate: FixedRiskBacktestOptions["colorGate"], color: FramaCandleColor | undefined, direction: FlipDirection): boolean {
  if (colorGate !== "withTrend") {
    return true;
  }
  return direction === "long" ? color === "up" : color === "down";
}

function targetsForEntry(row: ParsedKline, direction: FlipDirection, options: FixedRiskBacktestOptions): { stop: number; takeProfit: number; stopPct: number } | undefined {
  const stop =
    options.stopMode === "percent"
      ? direction === "long"
        ? row.close * (1 - (options.stopPct ?? 0))
        : row.close * (1 + (options.stopPct ?? 0))
      : direction === "long"
        ? row.low
        : row.high;
  const riskPerUnit = Math.abs(row.close - stop);
  if (riskPerUnit <= 0) {
    return undefined;
  }
  const stopPct = riskPerUnit / row.close;
  if (options.minStopPct !== undefined && stopPct < options.minStopPct) {
    return undefined;
  }
  if (options.maxStopPct !== undefined && stopPct > options.maxStopPct) {
    return undefined;
  }
  const takeProfit =
    direction === "long"
      ? row.close + riskPerUnit * options.riskRewardRatio
      : row.close - riskPerUnit * options.riskRewardRatio;
  return { stop, takeProfit, stopPct };
}

function closeFixedRiskTrade(
  symbol: string,
  position: {
    direction: FlipDirection;
    entryRow: ParsedKline;
    stopPrice: number;
    takeProfitPrice: number;
    riskUsdt: number;
    notionalUsdt: number;
    quantity: number;
  },
  exitRow: ParsedKline,
  exitPrice: number,
  feeRate: number,
  exitReason: ResearchExitReason,
  equityAfterUsdt: number
): FixedRiskTrade {
  const grossPnlUsdt =
    position.direction === "long"
      ? (exitPrice - position.entryRow.close) * position.quantity
      : (position.entryRow.close - exitPrice) * position.quantity;
  const feeUsdt = position.notionalUsdt * feeRate + exitPrice * position.quantity * feeRate;
  const pnlUsdt = exitReason === "liquidation" ? -position.riskUsdt : grossPnlUsdt - feeUsdt;
  return {
    symbol,
    direction: position.direction,
    entryTime: new Date(position.entryRow.openTime).toISOString(),
    exitTime: new Date(exitRow.openTime).toISOString(),
    entryPrice: position.entryRow.close,
    exitPrice,
    stopPrice: position.stopPrice,
    takeProfitPrice: position.takeProfitPrice,
    riskUsdt: position.riskUsdt,
    notionalUsdt: position.notionalUsdt,
    quantity: position.quantity,
    grossPnlUsdt,
    feeUsdt,
    pnlUsdt,
    equityAfterUsdt,
    exitReason
  };
}

export function runFixedRiskSignalBacktest(options: FixedRiskBacktestOptions): FixedRiskBacktestResult {
  const trades: FixedRiskTrade[] = [];
  let equity = options.initialEquityUsdt;
  let position:
    | {
        direction: FlipDirection;
        entryRow: ParsedKline;
        stopPrice: number;
        takeProfitPrice: number;
        riskUsdt: number;
        notionalUsdt: number;
        quantity: number;
      }
    | undefined;
  let tradingCandles = 0;
  let cooldownUntil = -1;
  let currentDay: string | undefined;
  let dayStartEquity = options.initialEquityUsdt;
  let dayPnl = 0;
  let dayHalted = false;

  function updateDailyGate(pnlUsdt: number): void {
    dayPnl += pnlUsdt;
    const dailyReturnPct = dayStartEquity > 0 ? (dayPnl / dayStartEquity) * 100 : 0;
    if (options.dailyProfitTargetPct !== undefined && dailyReturnPct >= options.dailyProfitTargetPct) {
      dayHalted = true;
    }
    if (options.dailyLossLimitPct !== undefined && dailyReturnPct <= -Math.abs(options.dailyLossLimitPct)) {
      dayHalted = true;
    }
  }

  function recordTrade(trade: FixedRiskTrade): void {
    equity += trade.pnlUsdt;
    trades.push({ ...trade, equityAfterUsdt: equity });
    updateDailyGate(trade.pnlUsdt);
  }

  for (let index = 0; index < options.rows.length; index += 1) {
    const row = options.rows[index];
    if (options.tradeStartTime !== undefined && row.openTime < options.tradeStartTime) {
      continue;
    }
    const rowDay = dayKey(row.openTime);
    if (currentDay === undefined) {
      currentDay = rowDay;
      dayStartEquity = equity;
    } else if (rowDay !== currentDay) {
      const previousRow = options.rows[index - 1];
      if (position && options.forceFlatAtDayEnd && previousRow) {
        const preview = closeFixedRiskTrade(options.symbol, position, previousRow, previousRow.close, options.feeRate, "day_end", equity);
        recordTrade(preview);
        position = undefined;
        cooldownUntil = index + (options.cooldownBars ?? 0);
      }
      currentDay = rowDay;
      dayStartEquity = equity;
      dayPnl = 0;
      dayHalted = false;
    }
    tradingCandles += 1;

    if (position && row.openTime > position.entryRow.openTime) {
      if (options.maintenanceMarginRate !== undefined) {
        const marginPct = position.notionalUsdt > 0 ? equity / position.notionalUsdt : 1 / options.maxLeverage;
        const liquidationPrice =
          position.direction === "long"
            ? position.entryRow.close * (1 - marginPct + options.maintenanceMarginRate)
            : position.entryRow.close * (1 + marginPct - options.maintenanceMarginRate);
        const liquidated = position.direction === "long" ? row.low <= liquidationPrice : row.high >= liquidationPrice;
        if (liquidated) {
          const trade = closeFixedRiskTrade(options.symbol, position, row, liquidationPrice, options.feeRate, "liquidation", equity - position.riskUsdt);
          recordTrade(trade);
          position = undefined;
          cooldownUntil = index + (options.cooldownBars ?? 0);
          continue;
        }
      }

      const hitStop = position.direction === "long" ? row.low <= position.stopPrice : row.high >= position.stopPrice;
      const hitTakeProfit = position.direction === "long" ? row.high >= position.takeProfitPrice : row.low <= position.takeProfitPrice;
      if (hitStop || hitTakeProfit) {
        const exitPrice = hitStop ? position.stopPrice : position.takeProfitPrice;
        const exitReason: ResearchExitReason = hitStop ? "stop_loss" : "take_profit";
        const preview = closeFixedRiskTrade(options.symbol, position, row, exitPrice, options.feeRate, exitReason, equity);
        recordTrade(preview);
        position = undefined;
        cooldownUntil = index + (options.cooldownBars ?? 0);
        continue;
      }
    }

    if (index < cooldownUntil || dayHalted) {
      continue;
    }
    const direction = directionForSignal(options.signals[index]);
    if (!direction || !colorAllows(options.colorGate, options.framaColors?.[index], direction)) {
      continue;
    }
    const targets = targetsForEntry(row, direction, options);
    if (!targets) {
      continue;
    }

    if (position) {
      if (position.direction === direction || options.allowReverse === false) {
        continue;
      }
      const preview = closeFixedRiskTrade(options.symbol, position, row, row.close, options.feeRate, "reverse", equity);
      recordTrade(preview);
      position = undefined;
      if (dayHalted) {
        continue;
      }
    }

    const riskUsdt = Math.max(0, equity * options.riskFraction);
    const riskPerUnit = Math.abs(row.close - targets.stop);
    const riskQuantity = riskUsdt / riskPerUnit;
    const maxQuantity = (equity * options.maxLeverage) / row.close;
    const quantity = Math.max(0, Math.min(riskQuantity, maxQuantity));
    if (quantity <= 0) {
      continue;
    }
    position = {
      direction,
      entryRow: row,
      stopPrice: targets.stop,
      takeProfitPrice: targets.takeProfit,
      riskUsdt: riskPerUnit * quantity,
      notionalUsdt: row.close * quantity,
      quantity
    };
  }

  const last = options.rows.at(-1);
  if (position && last) {
    const preview = closeFixedRiskTrade(options.symbol, position, last, last.close, options.feeRate, "end", equity);
    equity += preview.pnlUsdt;
    trades.push({ ...preview, equityAfterUsdt: equity });
  }

  const wins = trades.filter((trade) => trade.pnlUsdt > 0);
  const losses = trades.filter((trade) => trade.pnlUsdt < 0);
  const winSum = wins.reduce((sum, trade) => sum + trade.pnlUsdt, 0);
  const lossSum = Math.abs(losses.reduce((sum, trade) => sum + trade.pnlUsdt, 0));
  const netPnlUsdt = trades.reduce((sum, trade) => sum + trade.pnlUsdt, 0);

  let curveEquity = options.initialEquityUsdt;
  let peak = curveEquity;
  let maxDrawdownUsdt = 0;
  for (const trade of trades) {
    curveEquity += trade.pnlUsdt;
    peak = Math.max(peak, curveEquity);
    maxDrawdownUsdt = Math.max(maxDrawdownUsdt, peak - curveEquity);
  }

  const dailyMap = new Map<string, DailyResult>();
  let previousDaily: DailyResult | undefined;
  for (const row of options.rows) {
    if (options.tradeStartTime !== undefined && row.openTime < options.tradeStartTime) {
      continue;
    }
    const key = dayKey(row.openTime);
    if (!dailyMap.has(key)) {
      const startEquityUsdt = previousDaily?.endEquityUsdt ?? options.initialEquityUsdt;
      previousDaily = { day: key, startEquityUsdt, endEquityUsdt: startEquityUsdt, pnlUsdt: 0, returnPct: 0, trades: 0 };
      dailyMap.set(key, previousDaily);
    }
  }
  for (const trade of trades) {
    const key = dayKey(Date.parse(trade.exitTime));
    const daily = dailyMap.get(key);
    if (!daily) {
      continue;
    }
    daily.pnlUsdt += trade.pnlUsdt;
    daily.endEquityUsdt += trade.pnlUsdt;
    daily.trades += 1;
  }
  let previousEnd = options.initialEquityUsdt;
  for (const daily of dailyMap.values()) {
    daily.startEquityUsdt = previousEnd;
    daily.endEquityUsdt = previousEnd + daily.pnlUsdt;
    daily.returnPct = daily.startEquityUsdt > 0 ? (daily.pnlUsdt / daily.startEquityUsdt) * 100 : 0;
    previousEnd = daily.endEquityUsdt;
  }
  const daily = Array.from(dailyMap.values());
  const avgDailyReturnPct = daily.length > 0 ? daily.reduce((sum, value) => sum + value.returnPct, 0) / daily.length : 0;
  const minDailyReturnPct = daily.length > 0 ? Math.min(...daily.map((value) => value.returnPct)) : 0;

  return {
    symbol: options.symbol,
    candles: tradingCandles,
    trades,
    netPnlUsdt,
    endingEquityUsdt: equity,
    returnPct: options.initialEquityUsdt > 0 ? (netPnlUsdt / options.initialEquityUsdt) * 100 : 0,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    profitFactor: lossSum > 0 ? winSum / lossSum : wins.length > 0 ? 999 : 0,
    maxDrawdownPct: options.initialEquityUsdt > 0 ? (maxDrawdownUsdt / options.initialEquityUsdt) * 100 : 0,
    maxDrawdownUsdt,
    daily,
    avgDailyReturnPct,
    minDailyReturnPct
  };
}
