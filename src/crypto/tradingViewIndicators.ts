import type { ParsedKline } from "./types";

export type TradingViewSignal = "buy" | "sell";
export type FlipDirection = "long" | "short";
export type FramaCandleColor = "up" | "down" | "neutral";

export interface FramaChannelOptions {
  length: number;
  bandsDistance: number;
}

export interface FramaChannelPoint {
  openTime: number;
  frama?: number;
  upper?: number;
  lower?: number;
  breakUp: boolean;
  breakDown: boolean;
  candleColor: FramaCandleColor;
}

export interface RangeFilterOptions {
  samplingPeriod: number;
  rangeMultiplier: number;
}

export interface RangeFilterPoint {
  openTime: number;
  filter: number;
  highBand: number;
  lowBand: number;
  upward: number;
  downward: number;
  longCondition: boolean;
  shortCondition: boolean;
  signal?: TradingViewSignal;
}

export interface FlipSignalTrade {
  symbol: string;
  direction: FlipDirection;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  marginUsdt: number;
  leverage: number;
  notionalUsdt: number;
  quantity: number;
  grossPnlUsdt: number;
  feeUsdt: number;
  pnlUsdt: number;
  returnOnMarginPct: number;
  exitReason: "reverse" | "end" | "time_exit" | "liquidation" | "frama_channel" | "frama_neutral" | "take_profit" | "stop_loss";
}

export interface FlipSignalBacktestResult {
  symbol: string;
  candles: number;
  marginUsdt: number;
  leverage: number;
  trades: FlipSignalTrade[];
  netPnlUsdt: number;
  returnPct: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownUsdt: number;
  endingEquityUsdt: number;
  stoppedReason?: "equity_depleted";
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function emaSeries(values: number[], period: number): number[] {
  const alpha = 2 / (period + 1);
  const output: number[] = [];
  let previous: number | undefined;
  for (const value of values) {
    previous = previous === undefined ? value : value * alpha + previous * (1 - alpha);
    output.push(previous);
  }
  return output;
}

function highest(rows: ParsedKline[], start: number, endInclusive: number): number {
  let value = Number.NEGATIVE_INFINITY;
  for (let index = start; index <= endInclusive; index += 1) {
    value = Math.max(value, rows[index]?.high ?? value);
  }
  return value;
}

function lowest(rows: ParsedKline[], start: number, endInclusive: number): number {
  let value = Number.POSITIVE_INFINITY;
  for (let index = start; index <= endInclusive; index += 1) {
    value = Math.min(value, rows[index]?.low ?? value);
  }
  return value;
}

export function computeFramaChannelSeries(rows: ParsedKline[], options: FramaChannelOptions): FramaChannelPoint[] {
  const length = Math.max(2, Math.floor(options.length / 2) * 2);
  const half = length / 2;
  const prices = rows.map((row) => (row.high + row.low) / 2);
  const ranges = rows.map((row) => row.high - row.low);
  const rawFilt: number[] = [];
  const points: FramaChannelPoint[] = [];
  let filt: number | undefined;
  let candleColor: FramaCandleColor = "neutral";

  for (let index = 0; index < rows.length; index += 1) {
    const price = prices[index];
    let alpha = 1;
    if (index >= length - 1) {
      const n3 = (highest(rows, index - length + 1, index) - lowest(rows, index - length + 1, index)) / length;
      const n1 = (highest(rows, index - half + 1, index) - lowest(rows, index - half + 1, index)) / half;
      const n2 = (highest(rows, index - length + 1, index - half) - lowest(rows, index - length + 1, index - half)) / half;
      if (n1 > 0 && n2 > 0 && n3 > 0) {
        const dimension = (Math.log(n1 + n2) - Math.log(n3)) / Math.log(2);
        alpha = Math.max(Math.min(Math.exp(-4.6 * (dimension - 1)), 1), 0.01);
      }
    }

    filt = filt === undefined ? price : alpha * price + (1 - alpha) * filt;
    rawFilt.push(index < length + 1 ? price : filt);
    const frama = average(rawFilt.slice(Math.max(0, rawFilt.length - 5)));
    const volatility = average(ranges.slice(Math.max(0, index - 199), index + 1));
    const upper = frama + volatility * options.bandsDistance;
    const lower = frama - volatility * options.bandsDistance;
    const hlc3 = (rows[index].high + rows[index].low + rows[index].close) / 3;
    const previous = points.at(-1);
    const previousHlc3 = index > 0 ? (rows[index - 1].high + rows[index - 1].low + rows[index - 1].close) / 3 : hlc3;
    const previousClose = rows[index - 1]?.close ?? rows[index].close;
    const previousFrama = previous?.frama ?? frama;
    const crossedFrama =
      index > 0 && ((previousClose <= previousFrama && rows[index].close > frama) || (previousClose >= previousFrama && rows[index].close < frama));
    const breakUp = previous !== undefined && previousHlc3 <= (previous.upper ?? upper) && hlc3 > upper;
    const breakDown = previous !== undefined && previousHlc3 >= (previous.lower ?? lower) && hlc3 < lower;
    if (crossedFrama) {
      candleColor = "neutral";
    }
    if (breakUp) {
      candleColor = "up";
    } else if (breakDown) {
      candleColor = "down";
    }
    points.push({
      openTime: rows[index].openTime,
      frama,
      upper,
      lower,
      breakUp,
      breakDown,
      candleColor
    });
  }

  return points;
}

export function computeRangeFilterSeries(rows: ParsedKline[], options: RangeFilterOptions): RangeFilterPoint[] {
  const closes = rows.map((row) => row.close);
  const absoluteChanges = closes.map((close, index) => (index === 0 ? 0 : Math.abs(close - closes[index - 1])));
  const averageRange = emaSeries(absoluteChanges, options.samplingPeriod);
  const smoothRange = emaSeries(averageRange, options.samplingPeriod * 2 - 1).map((value) => value * options.rangeMultiplier);
  const points: RangeFilterPoint[] = [];
  let filter = closes[0] ?? 0;
  let upward = 0;
  let downward = 0;
  let conditionState = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const source = closes[index];
    const previousFilter = filter;
    const range = smoothRange[index] ?? 0;
    if (source > previousFilter) {
      filter = source - range < previousFilter ? previousFilter : source - range;
    } else {
      filter = source + range > previousFilter ? previousFilter : source + range;
    }

    upward = filter > previousFilter ? upward + 1 : filter < previousFilter ? 0 : upward;
    downward = filter < previousFilter ? downward + 1 : filter > previousFilter ? 0 : downward;
    const previousSource = closes[index - 1] ?? source;
    const longCondition = source > filter && upward > 0 && (source > previousSource || source < previousSource);
    const shortCondition = source < filter && downward > 0 && (source < previousSource || source > previousSource);
    const previousConditionState = conditionState;
    conditionState = longCondition ? 1 : shortCondition ? -1 : conditionState;
    const signal = longCondition && previousConditionState === -1 ? "buy" : shortCondition && previousConditionState === 1 ? "sell" : undefined;

    points.push({
      openTime: rows[index].openTime,
      filter,
      highBand: filter + range,
      lowBand: filter - range,
      upward,
      downward,
      longCondition,
      shortCondition,
      signal
    });
  }

  return points;
}

function closeTrade(
  symbol: string,
  direction: FlipDirection,
  entryRow: ParsedKline,
  exitRow: ParsedKline,
  marginUsdt: number,
  leverage: number,
  feeRate: number,
  exitReason: FlipSignalTrade["exitReason"]
): FlipSignalTrade {
  const notionalUsdt = marginUsdt * leverage;
  const quantity = notionalUsdt / entryRow.close;
  const grossPnlUsdt = direction === "long" ? (exitRow.close - entryRow.close) * quantity : (entryRow.close - exitRow.close) * quantity;
  const feeUsdt = notionalUsdt * feeRate + exitRow.close * quantity * feeRate;
  const pnlUsdt = exitReason === "liquidation" ? -marginUsdt : grossPnlUsdt - feeUsdt;
  return {
    symbol,
    direction,
    entryTime: new Date(entryRow.openTime).toISOString(),
    exitTime: new Date(exitRow.openTime).toISOString(),
    entryPrice: entryRow.close,
    exitPrice: exitRow.close,
    marginUsdt,
    leverage,
    notionalUsdt,
    quantity,
    grossPnlUsdt,
    feeUsdt,
    pnlUsdt,
    returnOnMarginPct: marginUsdt > 0 ? (pnlUsdt / marginUsdt) * 100 : 0,
    exitReason
  };
}

export function runFlipSignalBacktest(options: {
  symbol: string;
  rows: ParsedKline[];
  signals: readonly (TradingViewSignal | undefined)[];
  framaExitBands?: readonly ({ upper?: number; lower?: number } | undefined)[];
  marginUsdt: number;
  leverage: number;
  feeRate: number;
  tradeStartTime?: number;
  maintenanceMarginRate?: number;
  compoundEquity?: boolean;
  minTradeMarginUsdt?: number;
  maxHoldBars?: number;
}): FlipSignalBacktestResult {
  const trades: FlipSignalTrade[] = [];
  let position: { direction: FlipDirection; row: ParsedKline; index: number; marginUsdt: number; framaExitArmed: boolean } | undefined;
  let accountEquityUsdt = options.marginUsdt;
  let stoppedReason: FlipSignalBacktestResult["stoppedReason"];
  let tradingCandles = 0;

  for (let index = 0; index < options.rows.length; index += 1) {
    const row = options.rows[index];
    if (options.tradeStartTime !== undefined && row.openTime < options.tradeStartTime) {
      continue;
    }
    tradingCandles += 1;
    if (position && options.maintenanceMarginRate !== undefined) {
      const marginPct = 1 / options.leverage;
      const liquidationPrice =
        position.direction === "long"
          ? position.row.close * (1 - marginPct + options.maintenanceMarginRate)
          : position.row.close * (1 + marginPct - options.maintenanceMarginRate);
      const liquidated =
        position.direction === "long" ? row.low <= liquidationPrice : row.high >= liquidationPrice;
      if (liquidated) {
        const liquidationRow = { ...row, close: liquidationPrice };
        const trade = closeTrade(options.symbol, position.direction, position.row, liquidationRow, position.marginUsdt, options.leverage, options.feeRate, "liquidation");
        trades.push(trade);
        accountEquityUsdt += trade.pnlUsdt;
        if (options.compoundEquity && accountEquityUsdt <= (options.minTradeMarginUsdt ?? 0)) {
          accountEquityUsdt = Math.max(0, accountEquityUsdt);
          stoppedReason = "equity_depleted";
          position = undefined;
          break;
        }
        position = undefined;
        continue;
      }
    }

    if (position && options.framaExitBands) {
      const band = options.framaExitBands[index];
      const exitBand = position.direction === "long" ? band?.upper : band?.lower;
      if (exitBand !== undefined) {
        const touchedExitBand =
          position.direction === "long" ? row.low <= exitBand : row.high >= exitBand;
        if (position.framaExitArmed && touchedExitBand) {
          const exitRow = { ...row, close: exitBand };
          const trade = closeTrade(options.symbol, position.direction, position.row, exitRow, position.marginUsdt, options.leverage, options.feeRate, "frama_channel");
          trades.push(trade);
          accountEquityUsdt += trade.pnlUsdt;
          if (options.compoundEquity && accountEquityUsdt <= (options.minTradeMarginUsdt ?? 0)) {
            accountEquityUsdt = Math.max(0, accountEquityUsdt);
            stoppedReason = "equity_depleted";
            position = undefined;
            break;
          }
          position = undefined;
          continue;
        }
        const reachedProfitBand =
          position.direction === "long" ? row.high >= exitBand : row.low <= exitBand;
        position.framaExitArmed ||= reachedProfitBand;
      }
    }

    const nextMarginUsdt = options.compoundEquity ? accountEquityUsdt : options.marginUsdt;
    const signal = options.signals[index];
    const direction: FlipDirection | undefined = signal === "buy" ? "long" : signal === "sell" ? "short" : undefined;
    if (position && direction && position.direction !== direction) {
      const trade = closeTrade(options.symbol, position.direction, position.row, row, position.marginUsdt, options.leverage, options.feeRate, "reverse");
      trades.push(trade);
      accountEquityUsdt += trade.pnlUsdt;
      if (options.compoundEquity && accountEquityUsdt <= (options.minTradeMarginUsdt ?? 0)) {
        accountEquityUsdt = Math.max(0, accountEquityUsdt);
        stoppedReason = "equity_depleted";
        position = undefined;
        break;
      }
      position = { direction, row, index, marginUsdt: options.compoundEquity ? accountEquityUsdt : options.marginUsdt, framaExitArmed: false };
      continue;
    }
    if (position && options.maxHoldBars !== undefined && index - position.index >= options.maxHoldBars) {
      const trade = closeTrade(options.symbol, position.direction, position.row, row, position.marginUsdt, options.leverage, options.feeRate, "time_exit");
      trades.push(trade);
      accountEquityUsdt += trade.pnlUsdt;
      if (options.compoundEquity && accountEquityUsdt <= (options.minTradeMarginUsdt ?? 0)) {
        accountEquityUsdt = Math.max(0, accountEquityUsdt);
        stoppedReason = "equity_depleted";
        position = undefined;
        break;
      }
      position = undefined;
      continue;
    }
    if (!direction || position) {
      continue;
    }
    if (nextMarginUsdt <= (options.minTradeMarginUsdt ?? 0)) {
      stoppedReason = "equity_depleted";
      break;
    }
    position = { direction, row, index, marginUsdt: nextMarginUsdt, framaExitArmed: false };
  }

  const last = options.rows.at(-1);
  if (position && last) {
    const trade = closeTrade(options.symbol, position.direction, position.row, last, position.marginUsdt, options.leverage, options.feeRate, "end");
    trades.push(trade);
    accountEquityUsdt += trade.pnlUsdt;
    if (options.compoundEquity && accountEquityUsdt <= (options.minTradeMarginUsdt ?? 0)) {
      accountEquityUsdt = Math.max(0, accountEquityUsdt);
      stoppedReason = "equity_depleted";
    }
  }

  const wins = trades.filter((trade) => trade.pnlUsdt > 0);
  const losses = trades.filter((trade) => trade.pnlUsdt < 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdownUsdt = 0;
  for (const trade of trades) {
    equity += trade.pnlUsdt;
    peak = Math.max(peak, equity);
    maxDrawdownUsdt = Math.max(maxDrawdownUsdt, peak - equity);
  }
  const lossSum = Math.abs(losses.reduce((sum, trade) => sum + trade.pnlUsdt, 0));
  const winSum = wins.reduce((sum, trade) => sum + trade.pnlUsdt, 0);
  const netPnlUsdt = trades.reduce((sum, trade) => sum + trade.pnlUsdt, 0);

  return {
    symbol: options.symbol,
    candles: tradingCandles,
    marginUsdt: options.marginUsdt,
    leverage: options.leverage,
    trades,
    netPnlUsdt,
    returnPct: options.marginUsdt > 0 ? (netPnlUsdt / options.marginUsdt) * 100 : 0,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    profitFactor: lossSum > 0 ? winSum / lossSum : wins.length > 0 ? 999 : 0,
    maxDrawdownUsdt,
    endingEquityUsdt: options.compoundEquity ? accountEquityUsdt : options.marginUsdt + netPnlUsdt,
    stoppedReason
  };
}

function lineBelowEntry(entryPrice: number, values: Array<number | undefined>, fallback: number): number {
  const candidates = values.filter((value): value is number => value !== undefined && value < entryPrice);
  return candidates.length > 0 ? Math.max(...candidates) : fallback;
}

function lineAboveEntry(entryPrice: number, values: Array<number | undefined>, fallback: number): number {
  const candidates = values.filter((value): value is number => value !== undefined && value > entryPrice);
  return candidates.length > 0 ? Math.min(...candidates) : fallback;
}

function longPreTriggerTakeProfit(entryPrice: number, range: RangeFilterPoint, frama: FramaChannelPoint): number {
  const rangeWidth = Math.max(0, range.highBand - range.filter);
  const rangeTarget = entryPrice + rangeWidth;
  return frama.upper !== undefined && frama.upper > rangeTarget ? frama.upper : rangeTarget;
}

function shortPreTriggerTakeProfit(entryPrice: number, range: RangeFilterPoint, frama: FramaChannelPoint): number {
  const rangeWidth = Math.max(0, range.filter - range.lowBand);
  const rangeTarget = entryPrice - rangeWidth;
  return frama.lower !== undefined && frama.lower < rangeTarget ? frama.lower : rangeTarget;
}

function closeTradeAtPrice(
  symbol: string,
  position: { direction: FlipDirection; row: ParsedKline; marginUsdt: number },
  exitRow: ParsedKline,
  exitPrice: number,
  leverage: number,
  feeRate: number,
  exitReason: FlipSignalTrade["exitReason"]
): FlipSignalTrade {
  return closeTrade(symbol, position.direction, position.row, { ...exitRow, close: exitPrice }, position.marginUsdt, leverage, feeRate, exitReason);
}

export function runRangePreTriggerBacktest(options: {
  symbol: string;
  rows: ParsedKline[];
  range: readonly RangeFilterPoint[];
  frama: readonly FramaChannelPoint[];
  marginUsdt: number;
  leverage: number;
  feeRate: number;
  tradeStartTime?: number;
  maintenanceMarginRate?: number;
  compoundEquity?: boolean;
  minTradeMarginUsdt?: number;
  stopTrigger?: "wick" | "close";
}): FlipSignalBacktestResult {
  const trades: FlipSignalTrade[] = [];
  let position:
    | {
        direction: FlipDirection;
        row: ParsedKline;
        index: number;
        marginUsdt: number;
        stopPrice: number;
        takeProfitPrice?: number;
      }
    | undefined;
  let accountEquityUsdt = options.marginUsdt;
  let stoppedReason: FlipSignalBacktestResult["stoppedReason"];
  let tradingCandles = 0;
  let triggerState = 0;

  for (let index = 0; index < options.rows.length; index += 1) {
    const row = options.rows[index];
    if (options.tradeStartTime !== undefined && row.openTime < options.tradeStartTime) {
      const warmupSignal = options.range[index]?.signal;
      triggerState = warmupSignal === "buy" ? 1 : warmupSignal === "sell" ? -1 : triggerState;
      continue;
    }
    tradingCandles += 1;

    if (position && index > position.index) {
      if (options.maintenanceMarginRate !== undefined) {
        const marginPct = 1 / options.leverage;
        const liquidationPrice =
          position.direction === "long"
            ? position.row.close * (1 - marginPct + options.maintenanceMarginRate)
            : position.row.close * (1 + marginPct - options.maintenanceMarginRate);
        const liquidated = position.direction === "long" ? row.low <= liquidationPrice : row.high >= liquidationPrice;
        if (liquidated) {
          const trade = closeTradeAtPrice(options.symbol, position, row, liquidationPrice, options.leverage, options.feeRate, "liquidation");
          trades.push(trade);
          accountEquityUsdt += trade.pnlUsdt;
          if (options.compoundEquity && accountEquityUsdt <= (options.minTradeMarginUsdt ?? 0)) {
            accountEquityUsdt = Math.max(0, accountEquityUsdt);
            stoppedReason = "equity_depleted";
            position = undefined;
            break;
          }
          position = undefined;
          continue;
        }
      }

      const hitStop =
        options.stopTrigger === "close"
          ? position.direction === "long"
            ? row.close <= position.stopPrice
            : row.close >= position.stopPrice
          : position.direction === "long"
            ? row.low <= position.stopPrice
            : row.high >= position.stopPrice;
      const hitTakeProfit =
        position.takeProfitPrice !== undefined &&
        (position.direction === "long" ? row.high >= position.takeProfitPrice : row.low <= position.takeProfitPrice);
      if (hitStop || hitTakeProfit) {
        const exitPrice = hitStop ? (options.stopTrigger === "close" ? row.close : position.stopPrice) : position.takeProfitPrice ?? row.close;
        const exitReason: FlipSignalTrade["exitReason"] = hitStop ? "stop_loss" : "take_profit";
        const trade = closeTradeAtPrice(options.symbol, position, row, exitPrice, options.leverage, options.feeRate, exitReason);
        trades.push(trade);
        accountEquityUsdt += trade.pnlUsdt;
        if (options.compoundEquity && accountEquityUsdt <= (options.minTradeMarginUsdt ?? 0)) {
          accountEquityUsdt = Math.max(0, accountEquityUsdt);
          stoppedReason = "equity_depleted";
          position = undefined;
          break;
        }
        position = undefined;
        continue;
      }

      const currentRange = options.range[index];
      const currentFrama = options.frama[index];
      if (position.direction === "long") {
        position.stopPrice = Math.max(position.stopPrice, lineBelowEntry(row.close, [currentRange?.filter, currentFrama?.frama], position.stopPrice));
      } else {
        position.stopPrice = Math.min(position.stopPrice, lineAboveEntry(row.close, [currentRange?.filter, currentFrama?.frama], position.stopPrice));
      }
      continue;
    }

    if (position || index === 0) {
      continue;
    }

    const previousRange = options.range[index - 1];
    const previousFrama = options.frama[index - 1];
    if (!previousRange || !previousFrama) {
      continue;
    }
    const touchedLong = row.high >= previousRange.highBand;
    const touchedShort = row.low <= previousRange.lowBand;
    if (touchedLong === touchedShort) {
      continue;
    }
    if ((touchedLong && triggerState === 1) || (touchedShort && triggerState === -1)) {
      continue;
    }

    const nextMarginUsdt = options.compoundEquity ? accountEquityUsdt : options.marginUsdt;
    if (nextMarginUsdt <= (options.minTradeMarginUsdt ?? 0)) {
      stoppedReason = "equity_depleted";
      break;
    }

    if (touchedLong) {
      const entryPrice = previousRange.highBand;
      triggerState = 1;
      position = {
        direction: "long",
        row: { ...row, close: entryPrice },
        index,
        marginUsdt: nextMarginUsdt,
        stopPrice: lineBelowEntry(entryPrice, [previousRange.filter, previousFrama.frama], previousRange.lowBand),
        takeProfitPrice: longPreTriggerTakeProfit(entryPrice, previousRange, previousFrama)
      };
    } else {
      const entryPrice = previousRange.lowBand;
      triggerState = -1;
      position = {
        direction: "short",
        row: { ...row, close: entryPrice },
        index,
        marginUsdt: nextMarginUsdt,
        stopPrice: lineAboveEntry(entryPrice, [previousRange.filter, previousFrama.frama], previousRange.highBand),
        takeProfitPrice: shortPreTriggerTakeProfit(entryPrice, previousRange, previousFrama)
      };
    }
  }

  const last = options.rows.at(-1);
  if (position && last) {
    const trade = closeTradeAtPrice(options.symbol, position, last, last.close, options.leverage, options.feeRate, "end");
    trades.push(trade);
    accountEquityUsdt += trade.pnlUsdt;
    if (options.compoundEquity && accountEquityUsdt <= (options.minTradeMarginUsdt ?? 0)) {
      accountEquityUsdt = Math.max(0, accountEquityUsdt);
      stoppedReason = "equity_depleted";
    }
  }

  const wins = trades.filter((trade) => trade.pnlUsdt > 0);
  const losses = trades.filter((trade) => trade.pnlUsdt < 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdownUsdt = 0;
  for (const trade of trades) {
    equity += trade.pnlUsdt;
    peak = Math.max(peak, equity);
    maxDrawdownUsdt = Math.max(maxDrawdownUsdt, peak - equity);
  }
  const lossSum = Math.abs(losses.reduce((sum, trade) => sum + trade.pnlUsdt, 0));
  const winSum = wins.reduce((sum, trade) => sum + trade.pnlUsdt, 0);
  const netPnlUsdt = trades.reduce((sum, trade) => sum + trade.pnlUsdt, 0);

  return {
    symbol: options.symbol,
    candles: tradingCandles,
    marginUsdt: options.marginUsdt,
    leverage: options.leverage,
    trades,
    netPnlUsdt,
    returnPct: options.marginUsdt > 0 ? (netPnlUsdt / options.marginUsdt) * 100 : 0,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    profitFactor: lossSum > 0 ? winSum / lossSum : wins.length > 0 ? 999 : 0,
    maxDrawdownUsdt,
    endingEquityUsdt: options.compoundEquity ? accountEquityUsdt : options.marginUsdt + netPnlUsdt,
    stoppedReason
  };
}

export function runColorGatedSignalBacktest(options: {
  symbol: string;
  rows: ParsedKline[];
  signals: readonly (TradingViewSignal | undefined)[];
  framaColors: readonly (FramaCandleColor | undefined)[];
  marginUsdt: number;
  leverage: number;
  feeRate: number;
  tradeStartTime?: number;
  maintenanceMarginRate?: number;
  compoundEquity?: boolean;
  minTradeMarginUsdt?: number;
}): FlipSignalBacktestResult {
  const trades: FlipSignalTrade[] = [];
  let position: { direction: FlipDirection; row: ParsedKline; marginUsdt: number } | undefined;
  let accountEquityUsdt = options.marginUsdt;
  let stoppedReason: FlipSignalBacktestResult["stoppedReason"];
  let tradingCandles = 0;

  for (let index = 0; index < options.rows.length; index += 1) {
    const row = options.rows[index];
    if (options.tradeStartTime !== undefined && row.openTime < options.tradeStartTime) {
      continue;
    }
    tradingCandles += 1;
    const color = options.framaColors[index] ?? "neutral";

    if (position && options.maintenanceMarginRate !== undefined) {
      const marginPct = 1 / options.leverage;
      const liquidationPrice =
        position.direction === "long"
          ? position.row.close * (1 - marginPct + options.maintenanceMarginRate)
          : position.row.close * (1 + marginPct - options.maintenanceMarginRate);
      const liquidated = position.direction === "long" ? row.low <= liquidationPrice : row.high >= liquidationPrice;
      if (liquidated) {
        const liquidationRow = { ...row, close: liquidationPrice };
        const trade = closeTrade(options.symbol, position.direction, position.row, liquidationRow, position.marginUsdt, options.leverage, options.feeRate, "liquidation");
        trades.push(trade);
        accountEquityUsdt += trade.pnlUsdt;
        if (options.compoundEquity && accountEquityUsdt <= (options.minTradeMarginUsdt ?? 0)) {
          accountEquityUsdt = Math.max(0, accountEquityUsdt);
          stoppedReason = "equity_depleted";
          position = undefined;
          break;
        }
        position = undefined;
        continue;
      }
    }

    if (position && color === "neutral") {
      const trade = closeTrade(options.symbol, position.direction, position.row, row, position.marginUsdt, options.leverage, options.feeRate, "frama_neutral");
      trades.push(trade);
      accountEquityUsdt += trade.pnlUsdt;
      if (options.compoundEquity && accountEquityUsdt <= (options.minTradeMarginUsdt ?? 0)) {
        accountEquityUsdt = Math.max(0, accountEquityUsdt);
        stoppedReason = "equity_depleted";
        position = undefined;
        break;
      }
      position = undefined;
      continue;
    }

    const signal = options.signals[index];
    const allowedDirection: FlipDirection | undefined =
      signal === "buy" && color === "up" ? "long" : signal === "sell" && color === "down" ? "short" : undefined;
    if (!allowedDirection) {
      continue;
    }
    const nextMarginUsdt = options.compoundEquity ? accountEquityUsdt : options.marginUsdt;
    if (nextMarginUsdt <= (options.minTradeMarginUsdt ?? 0)) {
      stoppedReason = "equity_depleted";
      break;
    }
    if (!position) {
      position = { direction: allowedDirection, row, marginUsdt: nextMarginUsdt };
      continue;
    }
    if (position.direction === allowedDirection) {
      continue;
    }
    const trade = closeTrade(options.symbol, position.direction, position.row, row, position.marginUsdt, options.leverage, options.feeRate, "reverse");
    trades.push(trade);
    accountEquityUsdt += trade.pnlUsdt;
    if (options.compoundEquity && accountEquityUsdt <= (options.minTradeMarginUsdt ?? 0)) {
      accountEquityUsdt = Math.max(0, accountEquityUsdt);
      stoppedReason = "equity_depleted";
      position = undefined;
      break;
    }
    position = { direction: allowedDirection, row, marginUsdt: options.compoundEquity ? accountEquityUsdt : options.marginUsdt };
  }

  const last = options.rows.at(-1);
  if (position && last) {
    const trade = closeTrade(options.symbol, position.direction, position.row, last, position.marginUsdt, options.leverage, options.feeRate, "end");
    trades.push(trade);
    accountEquityUsdt += trade.pnlUsdt;
  }

  const wins = trades.filter((trade) => trade.pnlUsdt > 0);
  const losses = trades.filter((trade) => trade.pnlUsdt < 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdownUsdt = 0;
  for (const trade of trades) {
    equity += trade.pnlUsdt;
    peak = Math.max(peak, equity);
    maxDrawdownUsdt = Math.max(maxDrawdownUsdt, peak - equity);
  }
  const lossSum = Math.abs(losses.reduce((sum, trade) => sum + trade.pnlUsdt, 0));
  const winSum = wins.reduce((sum, trade) => sum + trade.pnlUsdt, 0);
  const netPnlUsdt = trades.reduce((sum, trade) => sum + trade.pnlUsdt, 0);

  return {
    symbol: options.symbol,
    candles: tradingCandles,
    marginUsdt: options.marginUsdt,
    leverage: options.leverage,
    trades,
    netPnlUsdt,
    returnPct: options.marginUsdt > 0 ? (netPnlUsdt / options.marginUsdt) * 100 : 0,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    profitFactor: lossSum > 0 ? winSum / lossSum : wins.length > 0 ? 999 : 0,
    maxDrawdownUsdt,
    endingEquityUsdt: options.compoundEquity ? accountEquityUsdt : options.marginUsdt + netPnlUsdt,
    stoppedReason
  };
}

function riskTargets(row: ParsedKline, direction: FlipDirection, riskRewardRatio: number): { stop: number; takeProfit: number } | undefined {
  if (direction === "long") {
    const risk = row.close - row.low;
    return risk > 0 ? { stop: row.low, takeProfit: row.close + risk * riskRewardRatio } : undefined;
  }
  const risk = row.high - row.close;
  return risk > 0 ? { stop: row.high, takeProfit: row.close - risk * riskRewardRatio } : undefined;
}

export function runRiskRewardSignalBacktest(options: {
  symbol: string;
  rows: ParsedKline[];
  signals: readonly (TradingViewSignal | undefined)[];
  riskRewardRatio: number;
  marginUsdt: number;
  leverage: number;
  feeRate: number;
  tradeStartTime?: number;
  maintenanceMarginRate?: number;
  compoundEquity?: boolean;
  minTradeMarginUsdt?: number;
}): FlipSignalBacktestResult {
  const trades: FlipSignalTrade[] = [];
  let position: { direction: FlipDirection; row: ParsedKline; marginUsdt: number; stop: number; takeProfit: number } | undefined;
  let accountEquityUsdt = options.marginUsdt;
  let stoppedReason: FlipSignalBacktestResult["stoppedReason"];
  let tradingCandles = 0;

  for (let index = 0; index < options.rows.length; index += 1) {
    const row = options.rows[index];
    if (options.tradeStartTime !== undefined && row.openTime < options.tradeStartTime) {
      continue;
    }
    tradingCandles += 1;

    if (position && options.maintenanceMarginRate !== undefined) {
      const marginPct = 1 / options.leverage;
      const liquidationPrice =
        position.direction === "long"
          ? position.row.close * (1 - marginPct + options.maintenanceMarginRate)
          : position.row.close * (1 + marginPct - options.maintenanceMarginRate);
      const liquidated = position.direction === "long" ? row.low <= liquidationPrice : row.high >= liquidationPrice;
      if (liquidated) {
        const liquidationRow = { ...row, close: liquidationPrice };
        const trade = closeTrade(options.symbol, position.direction, position.row, liquidationRow, position.marginUsdt, options.leverage, options.feeRate, "liquidation");
        trades.push(trade);
        accountEquityUsdt += trade.pnlUsdt;
        if (options.compoundEquity && accountEquityUsdt <= (options.minTradeMarginUsdt ?? 0)) {
          accountEquityUsdt = Math.max(0, accountEquityUsdt);
          stoppedReason = "equity_depleted";
          position = undefined;
          break;
        }
        position = undefined;
        continue;
      }
    }

    if (position && row.openTime > position.row.openTime) {
      const hitStop = position.direction === "long" ? row.low <= position.stop : row.high >= position.stop;
      const hitTakeProfit = position.direction === "long" ? row.high >= position.takeProfit : row.low <= position.takeProfit;
      if (hitStop || hitTakeProfit) {
        const exitPrice = hitStop ? position.stop : position.takeProfit;
        const exitReason = hitStop ? "stop_loss" : "take_profit";
        const trade = closeTrade(options.symbol, position.direction, position.row, { ...row, close: exitPrice }, position.marginUsdt, options.leverage, options.feeRate, exitReason);
        trades.push(trade);
        accountEquityUsdt += trade.pnlUsdt;
        if (options.compoundEquity && accountEquityUsdt <= (options.minTradeMarginUsdt ?? 0)) {
          accountEquityUsdt = Math.max(0, accountEquityUsdt);
          stoppedReason = "equity_depleted";
          position = undefined;
          break;
        }
        position = undefined;
        continue;
      }
    }

    const signal = options.signals[index];
    if (!signal) {
      continue;
    }
    const direction: FlipDirection = signal === "buy" ? "long" : "short";
    const targets = riskTargets(row, direction, options.riskRewardRatio);
    if (!targets) {
      continue;
    }
    const nextMarginUsdt = options.compoundEquity ? accountEquityUsdt : options.marginUsdt;
    if (nextMarginUsdt <= (options.minTradeMarginUsdt ?? 0)) {
      stoppedReason = "equity_depleted";
      break;
    }
    if (!position) {
      position = { direction, row, marginUsdt: nextMarginUsdt, ...targets };
      continue;
    }
    if (position.direction === direction) {
      continue;
    }
    const trade = closeTrade(options.symbol, position.direction, position.row, row, position.marginUsdt, options.leverage, options.feeRate, "reverse");
    trades.push(trade);
    accountEquityUsdt += trade.pnlUsdt;
    if (options.compoundEquity && accountEquityUsdt <= (options.minTradeMarginUsdt ?? 0)) {
      accountEquityUsdt = Math.max(0, accountEquityUsdt);
      stoppedReason = "equity_depleted";
      position = undefined;
      break;
    }
    position = { direction, row, marginUsdt: options.compoundEquity ? accountEquityUsdt : options.marginUsdt, ...targets };
  }

  const last = options.rows.at(-1);
  if (position && last) {
    const trade = closeTrade(options.symbol, position.direction, position.row, last, position.marginUsdt, options.leverage, options.feeRate, "end");
    trades.push(trade);
    accountEquityUsdt += trade.pnlUsdt;
  }

  const wins = trades.filter((trade) => trade.pnlUsdt > 0);
  const losses = trades.filter((trade) => trade.pnlUsdt < 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdownUsdt = 0;
  for (const trade of trades) {
    equity += trade.pnlUsdt;
    peak = Math.max(peak, equity);
    maxDrawdownUsdt = Math.max(maxDrawdownUsdt, peak - equity);
  }
  const lossSum = Math.abs(losses.reduce((sum, trade) => sum + trade.pnlUsdt, 0));
  const winSum = wins.reduce((sum, trade) => sum + trade.pnlUsdt, 0);
  const netPnlUsdt = trades.reduce((sum, trade) => sum + trade.pnlUsdt, 0);

  return {
    symbol: options.symbol,
    candles: tradingCandles,
    marginUsdt: options.marginUsdt,
    leverage: options.leverage,
    trades,
    netPnlUsdt,
    returnPct: options.marginUsdt > 0 ? (netPnlUsdt / options.marginUsdt) * 100 : 0,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    profitFactor: lossSum > 0 ? winSum / lossSum : wins.length > 0 ? 999 : 0,
    maxDrawdownUsdt,
    endingEquityUsdt: options.compoundEquity ? accountEquityUsdt : options.marginUsdt + netPnlUsdt,
    stoppedReason
  };
}
