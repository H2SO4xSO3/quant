import { analyzeChanStructure } from "./chanStructure";
import type {
  BinanceAggTrade,
  BinanceDepth,
  BinanceKline,
  CryptoDeepTrades,
  CryptoFootprint,
  CryptoHourlyStructure,
  CryptoLiquidity,
  CryptoMarketAnalysis,
  CryptoStrategyConfig,
  CryptoTrendMetrics,
  CryptoVolumeProfile,
  ParsedKline
} from "./types";

const DEFAULT_INDICATOR_STRATEGY_CONFIG: CryptoStrategyConfig = {
  minBuyScore: 94,
  emaFastPeriod: 9,
  emaSlowPeriod: 21,
  emaTrendPeriod: 50,
  higherEmaFastPeriod: 20,
  higherEmaSlowPeriod: 50,
  rsiPeriod: 14,
  atrPeriod: 14,
  atrStopMultiplier: 2.4,
  takeProfitRiskMultiple: 2.4,
  minPriceVwapPct: 0.15,
  maxPriceVwapPct: 3,
  minEmaFastSlopePct: 0.04,
  minHigherTrendGapPct: 0.05,
  minTakeProfitPct: 0.55,
  minExpectedValuePct: 0.08,
  estimatedSlippagePct: 0.03,
  priceImpactPct: 0.04,
  maxSpreadPct: 0.18,
  entryCooldownMinutes: 180,
  breakevenTriggerPct: 0.45,
  trailingStopTriggerPct: 0.75,
  trailingStopGivebackPct: 0.35,
  signalExitScore: 42,
  maxHoldingMinutes: 60,
  maxPositionLossUsdt: 3,
  feeRate: 0.001
};

export const DONCHIAN_CLOSE_PERIODS = [216, 360, 432, 576, 720, 864] as const;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const roundPrice = (value: number) => Math.round(value * 100) / 100;

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseKline(kline: BinanceKline): ParsedKline {
  const openTime = toNumber(kline[0]);
  const closeTime = toNumber(kline[6]);
  const open = toNumber(kline[1]);
  const high = toNumber(kline[2]);
  const low = toNumber(kline[3]);
  const close = toNumber(kline[4]);
  const volume = toNumber(kline[5]);
  const quoteVolume = toNumber(kline[7]) || close * volume;
  return { openTime, closeTime, open, high, low, close, volume, quoteVolume };
}

export function ema(values: number[], period: number): number {
  if (values.length === 0) {
    return 0;
  }
  const alpha = 2 / (period + 1);
  let previous = values[0];
  for (let index = 1; index < values.length; index += 1) {
    previous = values[index] * alpha + previous * (1 - alpha);
  }
  return previous;
}

function emaAt(values: number[], period: number, endExclusive: number): number {
  return ema(values.slice(0, Math.max(0, endExclusive)), period);
}

export function computeRsi(values: number[], period: number): number {
  if (values.length <= period) {
    return 50;
  }

  let gains = 0;
  let losses = 0;
  const start = values.length - period;
  for (let index = start; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  if (losses === 0) {
    return gains > 0 ? 100 : 50;
  }

  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

export function computeAtr(rows: ParsedKline[], period: number): number {
  if (rows.length < 2) {
    return 0;
  }

  const ranges: number[] = [];
  const start = Math.max(1, rows.length - period);
  for (let index = start; index < rows.length; index += 1) {
    const previousClose = rows[index - 1].close;
    ranges.push(Math.max(rows[index].high - rows[index].low, Math.abs(rows[index].high - previousClose), Math.abs(rows[index].low - previousClose)));
  }

  return ranges.reduce((sum, value) => sum + value, 0) / Math.max(ranges.length, 1);
}

export function computeVwap(rows: ParsedKline[]): number {
  const quote = rows.reduce((sum, row) => sum + row.quoteVolume, 0);
  const volume = rows.reduce((sum, row) => sum + row.volume, 0);
  return volume > 0 ? quote / volume : 0;
}

export function computeBollingerBands(values: number[], period = 20, standardDeviations = 2) {
  const window = values.slice(-period);
  if (window.length < period) {
    return undefined;
  }

  const middle = window.reduce((sum, value) => sum + value, 0) / window.length;
  const variance = window.reduce((sum, value) => sum + (value - middle) ** 2, 0) / window.length;
  const deviation = Math.sqrt(variance);
  const upper = middle + deviation * standardDeviations;
  const lower = middle - deviation * standardDeviations;
  const price = values.at(-1) ?? middle;
  const width = upper - lower;

  return {
    period,
    middle,
    upper,
    lower,
    bandwidthPct: middle > 0 ? (width / middle) * 100 : 0,
    percentB: width > 0 ? (price - lower) / width : 0.5
  };
}

export function computeVolatilityChannel(rows: ParsedKline[], period = 20, standardDeviations = 2) {
  if (rows.length <= period) {
    return undefined;
  }

  const current = rows.at(-1);
  const priorWindow = rows.slice(0, -1).slice(-period);
  if (!current || priorWindow.length < period) {
    return undefined;
  }

  const closes = priorWindow.map((row) => row.close);
  const basis = closes.reduce((sum, value) => sum + value, 0) / closes.length;
  const variance = closes.reduce((sum, value) => sum + (value - basis) ** 2, 0) / closes.length;
  const deviation = Math.sqrt(variance);
  const upper = basis + deviation * standardDeviations;
  const lower = basis - deviation * standardDeviations;
  const highestHigh = Math.max(...priorWindow.map((row) => row.high));
  const lowestLow = Math.min(...priorWindow.map((row) => row.low));
  const breakoutLine = Math.max(upper, highestHigh);
  const width = upper - lower;

  return {
    period,
    basis,
    upper,
    lower,
    highestHigh,
    lowestLow,
    breakoutLine,
    breakoutPct: breakoutLine > 0 ? ((current.close - breakoutLine) / breakoutLine) * 100 : 0,
    bandwidthPct: basis > 0 ? (width / basis) * 100 : 0
  };
}

export function computeDonchianCloseChannel(rows: ParsedKline[], period = 432) {
  const current = rows.at(-1);
  const priorWindow = rows.slice(0, -1).slice(-period);
  if (!current || priorWindow.length < period) {
    return undefined;
  }

  const closes = priorWindow.map((row) => row.close);
  const upperClose = Math.max(...closes);
  const lowerClose = Math.min(...closes);

  return {
    period,
    upperClose,
    lowerClose,
    breakoutPct: upperClose > 0 ? ((current.close - upperClose) / upperClose) * 100 : 0,
    breakdownPct: lowerClose > 0 ? ((current.close - lowerClose) / lowerClose) * 100 : 0,
    rangePct: current.close > 0 ? ((upperClose - lowerClose) / current.close) * 100 : 0
  };
}

export function computeDonchianCloseChannels(rows: ParsedKline[], periods: readonly number[] = DONCHIAN_CLOSE_PERIODS) {
  const channels: Record<number, NonNullable<ReturnType<typeof computeDonchianCloseChannel>>> = {};

  for (const period of periods) {
    const channel = computeDonchianCloseChannel(rows, period);
    if (channel) {
      channels[period] = channel;
    }
  }

  return Object.keys(channels).length > 0 ? channels : undefined;
}

export function computeHourlyStructure(rows: ParsedKline[], lookback = 6): CryptoHourlyStructure | undefined {
  const current = rows.at(-1);
  const priorWindow = rows.slice(0, -1).slice(-lookback);
  if (!current || priorWindow.length < 3) {
    return undefined;
  }

  const support = Math.min(...priorWindow.map((row) => row.low));
  const resistance = Math.max(...priorWindow.map((row) => row.high));
  if (support <= 0 || resistance <= 0) {
    return undefined;
  }

  if (current.close < support) {
    return {
      bias: "short",
      support: roundPrice(support),
      resistance: roundPrice(resistance),
      brokenLevel: roundPrice(support),
      brokenLevelKind: "support",
      breakoutPct: ((current.close - support) / support) * 100,
      distanceFromBrokenLevelPct: ((support - current.close) / support) * 100,
      rows: rows.length
    };
  }

  if (current.close > resistance) {
    return {
      bias: "long",
      support: roundPrice(support),
      resistance: roundPrice(resistance),
      brokenLevel: roundPrice(resistance),
      brokenLevelKind: "resistance",
      breakoutPct: ((current.close - resistance) / resistance) * 100,
      distanceFromBrokenLevelPct: ((current.close - resistance) / resistance) * 100,
      rows: rows.length
    };
  }

  return {
    bias: "neutral",
    support: roundPrice(support),
    resistance: roundPrice(resistance),
    breakoutPct: 0,
    distanceFromBrokenLevelPct: 0,
    rows: rows.length
  };
}

export function computeVolumeRatio(rows: ParsedKline[], period = 40): number {
  const current = rows.at(-1);
  const priorWindow = rows.slice(0, -1).slice(-period);
  if (!current || priorWindow.length === 0) {
    return 1;
  }

  const averageVolume = priorWindow.reduce((sum, row) => sum + row.volume, 0) / priorWindow.length;
  return averageVolume > 0 ? current.volume / averageVolume : 1;
}

function computeVolumeProfile(rows: ParsedKline[], price: number): CryptoVolumeProfile {
  const bucketCount = 12;
  const low = Math.min(...rows.map((row) => row.low));
  const high = Math.max(...rows.map((row) => row.high));
  const width = Math.max((high - low) / bucketCount, 0.00000001);
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    low: low + width * index,
    high: low + width * (index + 1),
    price: low + width * (index + 0.5),
    volume: 0,
    intensity: 0
  }));

  for (const row of rows) {
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((row.close - low) / width)));
    buckets[index].volume += row.volume;
  }

  const maxVolume = Math.max(...buckets.map((bucket) => bucket.volume), 1);
  for (const bucket of buckets) {
    bucket.intensity = bucket.volume / maxVolume;
  }
  const point = [...buckets].sort((a, b) => b.volume - a.volume)[0];
  const sorted = [...buckets].sort((a, b) => b.volume - a.volume);
  const target = rows.reduce((sum, row) => sum + row.volume, 0) * 0.7;
  let accumulated = 0;
  const valueBuckets = [];
  for (const bucket of sorted) {
    accumulated += bucket.volume;
    valueBuckets.push(bucket);
    if (accumulated >= target) {
      break;
    }
  }
  const valueAreaLow = Math.min(...valueBuckets.map((bucket) => bucket.low));
  const valueAreaHigh = Math.max(...valueBuckets.map((bucket) => bucket.high));

  return {
    pointOfControl: { price: roundPrice(point.price), volume: point.volume, intensity: point.intensity },
    valueAreaLow: roundPrice(valueAreaLow),
    valueAreaHigh: roundPrice(valueAreaHigh),
    currentPricePosition: price < valueAreaLow ? "below_value" : price > valueAreaHigh ? "above_value" : "inside_value"
  };
}

function computeFootprint(trades: BinanceAggTrade[]): CryptoFootprint {
  let buyVolume = 0;
  let sellVolume = 0;

  for (const trade of trades) {
    const volume = toNumber(trade.q);
    if (trade.m) {
      sellVolume += volume;
    } else {
      buyVolume += volume;
    }
  }

  const total = buyVolume + sellVolume;
  return { buyVolume, sellVolume, buySellImbalance: total > 0 ? (buyVolume - sellVolume) / total : 0 };
}

function computeDeepTrades(trades: BinanceAggTrade[]): CryptoDeepTrades {
  const volumes = trades.map((trade) => toNumber(trade.q)).filter((volume) => volume > 0);
  const average = volumes.reduce((sum, volume) => sum + volume, 0) / Math.max(volumes.length, 1);
  const large = trades.filter((trade) => toNumber(trade.q) >= average * 2);
  const largeBuyVolume = large.filter((trade) => !trade.m).reduce((sum, trade) => sum + toNumber(trade.q), 0);
  const largeVolume = large.reduce((sum, trade) => sum + toNumber(trade.q), 0);
  const largeTradeBuyRatio = largeVolume > 0 ? largeBuyVolume / largeVolume : 0;

  return { largeTradeCount: large.length, largeTradeBuyRatio, score: clamp(largeTradeBuyRatio) };
}

function computeLiquidity(depth: BinanceDepth, price: number): CryptoLiquidity {
  const bids = depth.bids.map(([p, q]) => ({ price: toNumber(p), quantity: toNumber(q), notional: toNumber(p) * toNumber(q) }));
  const asks = depth.asks.map(([p, q]) => ({ price: toNumber(p), quantity: toNumber(q), notional: toNumber(p) * toNumber(q) }));
  const bidNotional = bids.reduce((sum, row) => sum + row.notional, 0);
  const askNotional = asks.reduce((sum, row) => sum + row.notional, 0);
  const bidWall = [...bids].sort((a, b) => b.notional - a.notional)[0] ?? { price: 0 };
  const askWall = [...asks].sort((a, b) => b.notional - a.notional)[0] ?? { price: 0 };
  const nearestAsk = asks.filter((ask) => ask.price >= price).sort((a, b) => a.price - b.price)[0] ?? askWall;

  return {
    bidWallPrice: bidWall.price,
    askWallPrice: askWall.price,
    bidAskImbalance: bidNotional + askNotional > 0 ? (bidNotional - askNotional) / (bidNotional + askNotional) : 0,
    nearestAskDistancePct: nearestAsk.price > 0 ? ((nearestAsk.price - price) / price) * 100 : 0
  };
}

function classifyTrend(fast: number, slow: number, price: number, slopePct: number): "bullish" | "neutral" | "bearish" {
  if (fast > slow && price > slow && slopePct > -0.05) {
    return "bullish";
  }
  if (fast < slow && price < slow) {
    return "bearish";
  }
  return "neutral";
}

function computeTrend(rows: ParsedKline[], higherRows: ParsedKline[], config: CryptoStrategyConfig): CryptoTrendMetrics {
  const closes = rows.map((row) => row.close);
  const higherCloses = higherRows.length > 0 ? higherRows.map((row) => row.close) : closes;
  const price = closes.at(-1) ?? 0;
  const emaFast = ema(closes, config.emaFastPeriod);
  const emaSlow = ema(closes, config.emaSlowPeriod);
  const emaTrend = ema(closes, config.emaTrendPeriod);
  const previousFast = emaAt(closes, config.emaFastPeriod, closes.length - 3) || emaFast;
  const higherEmaFast = ema(higherCloses, config.higherEmaFastPeriod);
  const higherEmaSlow = ema(higherCloses, config.higherEmaSlowPeriod);
  const atr = computeAtr(rows, config.atrPeriod);
  const emaFastSlopePct = previousFast > 0 ? ((emaFast - previousFast) / previousFast) * 100 : 0;
  const rsi = computeRsi(closes, config.rsiPeriod);

  return {
    emaFast,
    emaSlow,
    emaTrend,
    emaFastSlopePct,
    higherEmaFast,
    higherEmaSlow,
    rsi,
    atr,
    atrPct: price > 0 ? (atr / price) * 100 : 0,
    trend: classifyTrend(emaFast, emaSlow, price, emaFastSlopePct),
    higherTrend: classifyTrend(higherEmaFast, higherEmaSlow, higherCloses.at(-1) ?? price, 0)
  };
}

export function analyzeMarket(input: {
  symbol: string;
  klines: BinanceKline[];
  higherKlines?: BinanceKline[];
  hourlyKlines?: BinanceKline[];
  depth: BinanceDepth;
  trades: BinanceAggTrade[];
  strategyConfig?: CryptoStrategyConfig;
}): CryptoMarketAnalysis {
  const rows: ParsedKline[] = [];
  for (const kline of input.klines) {
    const row = parseKline(kline);
    if (row.close > 0 && row.volume > 0) {
      rows.push(row);
    }
  }

  const higherRows: ParsedKline[] = [];
  for (const kline of input.higherKlines ?? []) {
    const row = parseKline(kline);
    if (row.close > 0 && row.volume > 0) {
      higherRows.push(row);
    }
  }

  const hourlyRows: ParsedKline[] = [];
  for (const kline of input.hourlyKlines ?? []) {
    const row = parseKline(kline);
    if (row.close > 0 && row.volume > 0) {
      hourlyRows.push(row);
    }
  }

  const last = rows.at(-1);
  const price = last?.close ?? 0;
  const vwap = computeVwap(rows);
  let high = 0;
  let low = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    high = Math.max(high, row.high);
    low = Math.min(low, row.low);
  }
  if (!Number.isFinite(low)) {
    low = 0;
  }
  const candleRange = last ? last.high - last.low : 0;
  const candleBodyPct = last && last.open > 0 ? (Math.abs(last.close - last.open) / last.open) * 100 : 0;
  const closePosition = last && candleRange > 0 ? (last.close - last.low) / candleRange : 0.5;
  const lowerWickPct = last && last.open > 0 ? ((Math.min(last.open, last.close) - last.low) / last.open) * 100 : 0;
  const upperWickPct = last && last.open > 0 ? ((last.high - Math.max(last.open, last.close)) / last.open) * 100 : 0;

  return {
    symbol: input.symbol,
    price,
    vwap,
    priceVsVwapPct: vwap > 0 ? ((price - vwap) / vwap) * 100 : 0,
    volatilityPct: price > 0 ? ((high - low) / price) * 100 : 0,
    trend: computeTrend(rows, higherRows, input.strategyConfig ?? DEFAULT_INDICATOR_STRATEGY_CONFIG),
    technical: {
      bollinger: computeBollingerBands(rows.map((row) => row.close)),
      volatilityChannel: computeVolatilityChannel(rows),
      donchianClose: computeDonchianCloseChannel(rows),
      donchianCloseByPeriod: computeDonchianCloseChannels(rows),
      hourlyStructure: computeHourlyStructure(hourlyRows),
      chan: analyzeChanStructure(rows),
      volumeRatio: computeVolumeRatio(rows),
      candleBodyPct,
      closePosition,
      lowerWickPct,
      upperWickPct
    },
    volumeProfile: computeVolumeProfile(rows, price),
    footprint: computeFootprint(input.trades),
    deepTrades: computeDeepTrades(input.trades),
    liquidity: computeLiquidity(input.depth, price),
    reasons: []
  };
}
