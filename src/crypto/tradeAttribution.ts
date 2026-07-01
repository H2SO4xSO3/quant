import type { BacktestTrade } from "./backtest";

export interface AttributionGroup {
  tradeCount: number;
  count: number;
  wins: number;
  winRatePct: number;
  avgPnlPct: number;
  avgPnlUsdt: number;
  netPnlUsdt: number;
  profitFactor: number;
}

export interface TradeAttributionReport {
  generatedAt: string;
  totals: AttributionGroup & {
    avgWinPct: number;
    avgLossPct: number;
    payoffRatio: number;
    expectancyPct: number;
    maxDrawdownUsdt: number;
    avgHoldingMinutes: number;
    medianHoldingMinutes: number;
  };
  byExitType: Record<string, AttributionGroup>;
  bySymbol: Record<string, AttributionGroup>;
  buckets: {
    rsi: Record<string, AttributionGroup>;
    priceVsVwapPct: Record<string, AttributionGroup>;
    emaFastSlopePct: Record<string, AttributionGroup>;
    spreadPct: Record<string, AttributionGroup>;
    holdingMinutes: Record<string, AttributionGroup>;
  };
  bestSymbols: string[];
  worstSymbols: string[];
  lossSources: string[];
  verdict: string;
}

export type AttributionExitType = BacktestTrade["reason"] | "manual_or_unknown";

export interface AttributionTrade {
  symbol: string;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  entryQuoteQty: number;
  pnlUsdt: number;
  pnlPct?: number;
  holdingMinutes?: number;
  reason?: AttributionExitType;
  exitType?: AttributionExitType;
  rsiAtEntry?: number;
  priceVsVwapPctAtEntry?: number;
  emaFastSlopeAtEntry?: number;
  spreadPctAtEntry?: number;
  estimatedSlippagePct?: number;
  btcTrendAtEntry?: string;
  maxFavorableExcursionPct?: number;
  maxAdverseExcursionPct?: number;
}

function round(value: number, digits = 6): number {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function pnlPct(trade: AttributionTrade): number {
  if (typeof trade.pnlPct === "number") {
    return trade.pnlPct;
  }
  return trade.entryQuoteQty > 0 ? (trade.pnlUsdt / trade.entryQuoteQty) * 100 : 0;
}

function holdingMinutes(trade: AttributionTrade): number {
  if (typeof trade.holdingMinutes === "number") {
    return trade.holdingMinutes;
  }
  const entry = Date.parse(trade.entryTime);
  const exit = Date.parse(trade.exitTime);
  return Number.isFinite(entry) && Number.isFinite(exit) ? (exit - entry) / 60_000 : 0;
}

function profitFactor(wins: number[], losses: number[]): number {
  const grossWin = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  if (grossLoss > 0) {
    return grossWin / grossLoss;
  }
  return grossWin > 0 ? 999 : 0;
}

function summarize(trades: AttributionTrade[]): AttributionGroup {
  const pnlUsdt = trades.map((trade) => trade.pnlUsdt);
  const pnlPctValues = trades.map(pnlPct);
  const wins = pnlUsdt.filter((value) => value > 0);
  const losses = pnlUsdt.filter((value) => value < 0);
  return {
    tradeCount: trades.length,
    count: trades.length,
    wins: wins.length,
    winRatePct: trades.length > 0 ? round((wins.length / trades.length) * 100, 3) : 0,
    avgPnlPct: trades.length > 0 ? round(pnlPctValues.reduce((sum, value) => sum + value, 0) / trades.length) : 0,
    avgPnlUsdt: trades.length > 0 ? round(pnlUsdt.reduce((sum, value) => sum + value, 0) / trades.length) : 0,
    netPnlUsdt: round(pnlUsdt.reduce((sum, value) => sum + value, 0)),
    profitFactor: round(profitFactor(wins, losses))
  };
}

function grouped(trades: AttributionTrade[], key: (trade: AttributionTrade) => string): Record<string, AttributionGroup> {
  const buckets = new Map<string, AttributionTrade[]>();
  for (const trade of trades) {
    const name = key(trade);
    buckets.set(name, [...(buckets.get(name) ?? []), trade]);
  }
  return Object.fromEntries(Array.from(buckets.entries()).map(([name, rows]) => [name, summarize(rows)]));
}

function bucketNumber(value: number | undefined, ranges: Array<[string, (value: number) => boolean]>): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "unavailable";
  }
  return ranges.find(([, predicate]) => predicate(value))?.[0] ?? "unavailable";
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function maxDrawdownUsdt(trades: AttributionTrade[]): number {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const trade of [...trades].sort((a, b) => Date.parse(a.exitTime) - Date.parse(b.exitTime))) {
    equity += trade.pnlUsdt;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return round(drawdown);
}

function rankedSymbols(bySymbol: Record<string, AttributionGroup>, direction: "best" | "worst"): string[] {
  return Object.entries(bySymbol)
    .sort((a, b) => direction === "best" ? b[1].netPnlUsdt - a[1].netPnlUsdt : a[1].netPnlUsdt - b[1].netPnlUsdt)
    .slice(0, 5)
    .map(([symbol, group]) => `${symbol} net=${group.netPnlUsdt}U pf=${group.profitFactor}`);
}

function identifyLossSources(trades: AttributionTrade[], byExitType: Record<string, AttributionGroup>, bySymbol: Record<string, AttributionGroup>): string[] {
  const losses = trades.filter((trade) => trade.pnlUsdt < 0);
  const sources: string[] = [];
  if (losses.some((trade) => (trade.priceVsVwapPctAtEntry ?? 0) >= 0.7 && (trade.maxFavorableExcursionPct ?? 0) < 0.3)) {
    sources.push("追高后回落");
  }
  if (losses.some((trade) => (trade.priceVsVwapPctAtEntry ?? 0) >= 0 && (trade.priceVsVwapPctAtEntry ?? 0) <= 0.3 && Math.abs(trade.pnlUsdt) > 0)) {
    sources.push("横盘假突破");
  }
  if ((byExitType.timeout?.netPnlUsdt ?? 0) < 0) {
    sources.push("timeout 后亏损");
  }
  if (losses.some((trade) => holdingMinutes(trade) >= 90 && Math.abs(pnlPct(trade)) < 0.35)) {
    sources.push("买入后长时间不动");
  }
  if (losses.some((trade) => Math.abs(pnlPct(trade)) <= ((trade.estimatedSlippagePct ?? 0) + (trade.spreadPctAtEntry ?? 0) + 0.2))) {
    sources.push("手续费/滑点/点差吃掉利润");
  }
  if (losses.some((trade) => trade.btcTrendAtEntry === "bearish")) {
    sources.push("大盘下跌时硬做多");
  }
  const noisySymbols = Object.entries(bySymbol)
    .filter(([symbol, group]) => !["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"].includes(symbol) && group.netPnlUsdt < 0)
    .map(([symbol]) => symbol);
  if (noisySymbols.length > 0) {
    sources.push("某些小币种噪声太大");
  }
  if ((byExitType.trailing_stop?.netPnlUsdt ?? 0) < 0) {
    sources.push("trailing stop 触发过早或过晚");
  }
  return [...new Set(sources)];
}

export function buildTradeAttributionReport(trades: AttributionTrade[], now = new Date()): TradeAttributionReport {
  const totalsBase = summarize(trades);
  const winPcts = trades.filter((trade) => trade.pnlUsdt > 0).map(pnlPct);
  const lossPcts = trades.filter((trade) => trade.pnlUsdt < 0).map(pnlPct);
  const avgWinPct = winPcts.length > 0 ? winPcts.reduce((sum, value) => sum + value, 0) / winPcts.length : 0;
  const avgLossPct = lossPcts.length > 0 ? lossPcts.reduce((sum, value) => sum + value, 0) / lossPcts.length : 0;
  const byExitType = grouped(trades, (trade) => trade.exitType ?? trade.reason ?? "manual_or_unknown");
  const bySymbol = grouped(trades, (trade) => trade.symbol);
  const totals = {
    ...totalsBase,
    avgWinPct: round(avgWinPct),
    avgLossPct: round(avgLossPct),
    payoffRatio: avgLossPct < 0 ? round(avgWinPct / Math.abs(avgLossPct)) : avgWinPct > 0 ? 999 : 0,
    expectancyPct: round(trades.length > 0 ? trades.reduce((sum, trade) => sum + pnlPct(trade), 0) / trades.length : 0),
    maxDrawdownUsdt: maxDrawdownUsdt(trades),
    avgHoldingMinutes: trades.length > 0 ? round(trades.reduce((sum, trade) => sum + holdingMinutes(trade), 0) / trades.length, 3) : 0,
    medianHoldingMinutes: round(median(trades.map(holdingMinutes)), 3)
  };
  const lossSources = identifyLossSources(trades, byExitType, bySymbol);
  return {
    generatedAt: now.toISOString(),
    totals,
    byExitType,
    bySymbol,
    buckets: {
      rsi: grouped(trades, (trade) => bucketNumber(trade.rsiAtEntry, [
        ["<45", (value) => value < 45],
        ["45-52", (value) => value >= 45 && value < 52],
        ["52-58", (value) => value >= 52 && value < 58],
        ["58-65", (value) => value >= 58 && value < 65],
        ["65-72", (value) => value >= 65 && value <= 72],
        [">72", (value) => value > 72]
      ])),
      priceVsVwapPct: grouped(trades, (trade) => bucketNumber(trade.priceVsVwapPctAtEntry, [
        ["<=0", (value) => value <= 0],
        ["0-0.3", (value) => value > 0 && value < 0.3],
        ["0.3-0.7", (value) => value >= 0.3 && value < 0.7],
        ["0.7-1.2", (value) => value >= 0.7 && value < 1.2],
        [">=1.2", (value) => value >= 1.2]
      ])),
      emaFastSlopePct: grouped(trades, (trade) => bucketNumber(trade.emaFastSlopeAtEntry, [
        ["<=0", (value) => value <= 0],
        ["0-0.04", (value) => value > 0 && value < 0.04],
        ["0.04-0.08", (value) => value >= 0.04 && value < 0.08],
        [">=0.08", (value) => value >= 0.08]
      ])),
      spreadPct: grouped(trades, (trade) => bucketNumber(trade.spreadPctAtEntry, [
        ["<=0.05", (value) => value <= 0.05],
        ["0.05-0.12", (value) => value > 0.05 && value <= 0.12],
        ["0.12-0.18", (value) => value > 0.12 && value <= 0.18],
        [">0.18", (value) => value > 0.18]
      ])),
      holdingMinutes: grouped(trades, (trade) => bucketNumber(holdingMinutes(trade), [
        ["<30", (value) => value < 30],
        ["30-60", (value) => value >= 30 && value <= 60],
        ["60-120", (value) => value > 60 && value <= 120],
        [">120", (value) => value > 120]
      ]))
    },
    bestSymbols: rankedSymbols(bySymbol, "best"),
    worstSymbols: rankedSymbols(bySymbol, "worst"),
    lossSources,
    verdict: totals.expectancyPct < 0 || totals.profitFactor < 1
      ? "Current sample shows negative expectancy; do not treat this as a proven edge."
      : "Current sample is positive, but still needs walk-forward and paper validation before readiness."
  };
}

function formatGroup(name: string, group: AttributionGroup): string {
  return `- ${name}: trades=${group.tradeCount}, win=${group.winRatePct}%, avgPct=${group.avgPnlPct}%, net=${group.netPnlUsdt}U, pf=${group.profitFactor}`;
}

export function formatTradeAttributionReport(report: TradeAttributionReport): string {
  return [
    `# Trade Attribution Report ${report.generatedAt}`,
    "",
    `Trades: ${report.totals.tradeCount}`,
    `Win Rate: ${report.totals.winRatePct}%`,
    `Avg Win: ${report.totals.avgWinPct}%`,
    `Avg Loss: ${report.totals.avgLossPct}%`,
    `Payoff Ratio: ${report.totals.payoffRatio}`,
    `Expectancy: ${report.totals.expectancyPct}%`,
    `Profit Factor: ${report.totals.profitFactor}`,
    `Max Drawdown: ${report.totals.maxDrawdownUsdt}U`,
    `Avg Holding: ${report.totals.avgHoldingMinutes}m`,
    `Median Holding: ${report.totals.medianHoldingMinutes}m`,
    `Verdict: ${report.verdict}`,
    "",
    "## Exit Types",
    ...Object.entries(report.byExitType).map(([name, group]) => formatGroup(name, group)),
    "",
    "## Symbols",
    ...Object.entries(report.bySymbol).map(([name, group]) => formatGroup(name, group)),
    "",
    "## Buckets: RSI",
    ...Object.entries(report.buckets.rsi).map(([name, group]) => formatGroup(name, group)),
    "",
    "## Buckets: Price vs VWAP",
    ...Object.entries(report.buckets.priceVsVwapPct).map(([name, group]) => formatGroup(name, group)),
    "",
    "## Buckets: EMA Fast Slope",
    ...Object.entries(report.buckets.emaFastSlopePct).map(([name, group]) => formatGroup(name, group)),
    "",
    "## Buckets: Spread",
    ...Object.entries(report.buckets.spreadPct).map(([name, group]) => formatGroup(name, group)),
    "",
    "## Buckets: Holding Minutes",
    ...Object.entries(report.buckets.holdingMinutes).map(([name, group]) => formatGroup(name, group)),
    "",
    "## Best Symbols",
    ...report.bestSymbols.map((item) => `- ${item}`),
    "",
    "## Worst Symbols",
    ...report.worstSymbols.map((item) => `- ${item}`),
    "",
    "## Loss Sources",
    ...(report.lossSources.length > 0 ? report.lossSources : ["No dominant loss source identified yet."]).map((item) => `- ${item}`)
  ].join("\n") + "\n";
}

