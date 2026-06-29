export type CryptoSide = "BUY" | "SELL";
export type CryptoSignalAction = "buy" | "sell" | "hold";
export type CryptoExecutionMode = "dry_run" | "paper" | "futures_paper" | "live";

export interface BinanceSymbolFilter {
  filterType: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  minNotional?: string;
  notional?: string;
  applyToMarket?: boolean;
}

export interface BinanceSymbolInfo {
  symbol: string;
  filters: BinanceSymbolFilter[];
}

export interface SymbolRules {
  symbol: string;
  tickSize: number;
  stepSize: number;
  minQty: number;
  maxQty: number;
  minNotional: number;
}

export interface NormalizedOrder {
  symbol: string;
  side: CryptoSide;
  type: "MARKET";
  quantity?: string;
  quoteOrderQty?: string;
}

export interface CryptoVolumeProfile {
  pointOfControl: { price: number; volume: number; intensity: number };
  valueAreaLow: number;
  valueAreaHigh: number;
  currentPricePosition: "below_value" | "inside_value" | "above_value";
}

export interface CryptoFootprint {
  buyVolume: number;
  sellVolume: number;
  buySellImbalance: number;
}

export interface CryptoDeepTrades {
  largeTradeCount: number;
  largeTradeBuyRatio: number;
  score: number;
}

export interface CryptoLiquidity {
  bidWallPrice: number;
  askWallPrice: number;
  bidAskImbalance: number;
  nearestAskDistancePct: number;
}

export interface CryptoTrendMetrics {
  emaFast: number;
  emaSlow: number;
  emaTrend: number;
  emaFastSlopePct: number;
  higherEmaFast: number;
  higherEmaSlow: number;
  rsi: number;
  atr: number;
  atrPct: number;
  trend: "bullish" | "neutral" | "bearish";
  higherTrend: "bullish" | "neutral" | "bearish";
}

export interface CryptoBollingerBands {
  period: number;
  middle: number;
  upper: number;
  lower: number;
  bandwidthPct: number;
  percentB: number;
}

export interface CryptoVolatilityChannel {
  period: number;
  basis: number;
  upper: number;
  lower: number;
  highestHigh: number;
  lowestLow: number;
  breakoutLine: number;
  breakoutPct: number;
  bandwidthPct: number;
}

export type CryptoChanTrend = "up" | "down" | "neutral";
export type CryptoChanPricePosition = "below_pivot" | "inside_pivot" | "above_pivot" | "no_pivot";
export type CryptoChanDivergence = "bullish" | "bearish" | "none";
export type CryptoChanSetup =
  | "insufficient_structure"
  | "center_chop"
  | "buy_divergence"
  | "sell_divergence"
  | "third_buy_candidate"
  | "third_sell_candidate"
  | "trend_follow";

export interface CryptoChanFractal {
  kind: "top" | "bottom";
  index: number;
  openTime: number;
  price: number;
}

export interface CryptoChanStroke {
  direction: "up" | "down";
  start: CryptoChanFractal;
  end: CryptoChanFractal;
  high: number;
  low: number;
  bars: number;
  strengthPctPerBar: number;
}

export interface CryptoChanPivotZone {
  low: number;
  high: number;
  startOpenTime: number;
  endOpenTime: number;
  strokeCount: number;
}

export interface CryptoChanStructure {
  trend: CryptoChanTrend;
  fractals: CryptoChanFractal[];
  strokes: CryptoChanStroke[];
  pivotZone?: CryptoChanPivotZone;
  pricePosition: CryptoChanPricePosition;
  divergence: CryptoChanDivergence;
  setup: CryptoChanSetup;
}
export type CryptoHourlyStructureBias = "long" | "short" | "neutral";
export type CryptoHourlyBrokenLevelKind = "support" | "resistance";

export interface CryptoHourlyStructure {
  bias: CryptoHourlyStructureBias;
  support: number;
  resistance: number;
  brokenLevel?: number;
  brokenLevelKind?: CryptoHourlyBrokenLevelKind;
  breakoutPct: number;
  distanceFromBrokenLevelPct: number;
  rows: number;
}

export interface CryptoDonchianCloseChannel {
  period: number;
  upperClose: number;
  lowerClose: number;
  breakoutPct: number;
  breakdownPct: number;
  rangePct: number;
}

export interface CryptoMarketRegime {
  benchmarkSymbol: string;
  isRiskOn: boolean;
  trend: CryptoTrendMetrics["trend"];
  higherTrend: CryptoTrendMetrics["higherTrend"];
  volumeRatio: number;
  volatilityBandwidthPct: number;
  atrPct: number;
  reasons: string[];
}

export interface CryptoMarketAnalysis {
  symbol: string;
  price: number;
  vwap: number;
  priceVsVwapPct: number;
  volatilityPct: number;
  trend?: CryptoTrendMetrics;
  technical?: {
    bollinger?: CryptoBollingerBands;
    volatilityChannel?: CryptoVolatilityChannel;
    donchianClose?: CryptoDonchianCloseChannel;
    donchianCloseByPeriod?: Record<number, CryptoDonchianCloseChannel>;
    hourlyStructure?: CryptoHourlyStructure;
    chan?: CryptoChanStructure;
    volumeRatio?: number;
    recentReturn6Pct?: number;
    candleBodyPct?: number;
    closePosition?: number;
    lowerWickPct?: number;
    upperWickPct?: number;
  };
  marketRegime?: CryptoMarketRegime;
  volumeProfile: CryptoVolumeProfile;
  footprint: CryptoFootprint;
  deepTrades: CryptoDeepTrades;
  liquidity: CryptoLiquidity;
  reasons: string[];
}

export interface CryptoStrategyConfig {
  minBuyScore: number;
  emaFastPeriod: number;
  emaSlowPeriod: number;
  emaTrendPeriod: number;
  higherEmaFastPeriod: number;
  higherEmaSlowPeriod: number;
  rsiPeriod: number;
  atrPeriod: number;
  atrStopMultiplier: number;
  takeProfitRiskMultiple: number;
  minPriceVwapPct: number;
  maxPriceVwapPct: number;
  minEmaFastSlopePct: number;
  minHigherTrendGapPct: number;
  minTakeProfitPct: number;
  minExpectedValuePct: number;
  estimatedSlippagePct: number;
  priceImpactPct: number;
  maxSpreadPct: number;
  entryCooldownMinutes: number;
  breakevenTriggerPct: number;
  trailingStopTriggerPct: number;
  trailingStopGivebackPct: number;
  signalExitScore: number;
  maxHoldingMinutes: number;
  maxPositionLossUsdt?: number;
  feeRate: number;
}

export interface AiReviewConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface AiTradeReview {
  decision: "approve" | "veto";
  confidence: number;
  reason: string;
  riskTags: string[];
}

export interface BacktestGuardConfig {
  enabled: boolean;
  reportPath: string;
  minNetPnlUsdt: number;
  minProfitFactor: number;
  minTrades: number;
  maxAgeHours: number;
  requireSymbolHealth: boolean;
  minSymbolNetPnlUsdt: number;
  minSymbolProfitFactor: number;
  minSymbolTrades: number;
}

export interface CryptoSignal {
  symbol: string;
  action: CryptoSignalAction;
  score: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  orderQuoteQty: number;
  maxHoldingMinutes?: number;
  reasons: string[];
  aiReview?: AiTradeReview;
}

export interface CryptoRiskConfig {
  liveTrading: boolean;
  maxOrderUsdt: number;
  dailyMaxLossUsdt: number;
  maxPositionLossUsdt?: number;
  maxOpenPositions: number;
}

export interface CryptoJournalEntry {
  id?: string;
  symbol: string;
  side: "BUY" | "SELL";
  direction?: "long" | "short";
  leverage?: number;
  price?: number;
  quantity?: number;
  quoteQty?: number;
  marginUsdt?: number;
  notionalUsdt?: number;
  liquidationPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  realizedPnlUsdt: number;
  open?: boolean;
  timestamp: string;
  mode?: CryptoExecutionMode;
  notes?: string[];
  entryTime?: string;
  exitTime?: string;
  entryPrice?: number;
  exitPrice?: number;
  pnlPct?: number;
  pnlUsdt?: number;
  holdingMinutes?: number;
  entryReason?: string;
  exitReason?: string;
  strategyId?: string;
  rsiAtEntry?: number;
  priceVsVwapPctAtEntry?: number;
  emaFastSlopeAtEntry?: number;
  higherTrendGapPctAtEntry?: number;
  spreadPctAtEntry?: number;
  estimatedSlippagePct?: number;
  btcTrendAtEntry?: string;
  maxFavorableExcursionPct?: number;
  maxAdverseExcursionPct?: number;
  exitType?: "stop_loss" | "take_profit" | "trailing_stop" | "timeout" | "signal_exit" | "manual_or_unknown" | "end";
}

export interface CryptoRiskDecision {
  allowed: boolean;
  mode: CryptoExecutionMode;
  reasons: string[];
}

export type BinanceKline = Array<number | string>;
export interface BinanceDepth {
  bids: string[][];
  asks: string[][];
}
export interface BinanceAggTrade {
  p: string;
  q: string;
  m: boolean;
  T: number;
}

export interface ParsedKline {
  openTime: number;
  closeTime?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
}

