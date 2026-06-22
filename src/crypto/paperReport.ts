import type { CryptoJournalEntry } from "./types";

export interface PaperReportOptions {
  initialCapitalUsdt: number;
  now?: Date;
  windowHours?: number;
}

export interface PaperReportGroup {
  trades: number;
  wins: number;
  winRatePct: number;
  netPnlUsdt: number;
  grossPnlUsdt: number;
  estimatedCostsUsdt: number;
  avgHoldMinutes: number;
}

export interface PaperClosedTrade {
  symbol: string;
  timestamp: string;
  reason: string;
  netPnlUsdt: number;
  grossPnlUsdt: number;
  estimatedCostsUsdt: number;
  holdMinutes?: number;
  entryPrice?: number;
  exitPrice?: number;
}

export interface PaperReport {
  generatedAt: string;
  windowHours: number;
  totals: PaperReportGroup & {
    closedTrades: number;
    openPositions: number;
    openCostUsdt: number;
    lifetimeRealizedPnlUsdt: number;
    cashUsdt: number;
    equityAtCostUsdt: number;
    costShareOfLossPct: number;
    grossWinRatePct: number;
  };
  byExitReason: Record<string, PaperReportGroup>;
  bySymbol: Record<string, PaperReportGroup>;
  recentClosed: PaperClosedTrade[];
  recommendations: string[];
}

const COST_NOTE_PATTERN = /^Estimated paper costs ([0-9.]+)U/;

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function estimatedCosts(entry: CryptoJournalEntry): number {
  const note = entry.notes?.find((item) => COST_NOTE_PATTERN.test(item));
  const match = note?.match(COST_NOTE_PATTERN);
  return match ? Number(match[1]) : 0;
}

function exitReason(entry: CryptoJournalEntry): string {
  const note = entry.notes?.[0] ?? "";
  return note.replace(/^Paper /, "").replace(/ exit$/, "") || "unknown";
}

function matchingBuy(sell: CryptoJournalEntry, buys: CryptoJournalEntry[]): CryptoJournalEntry | undefined {
  return buys
    .filter((buy) => buy.symbol === sell.symbol && Date.parse(buy.timestamp) <= Date.parse(sell.timestamp))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .find((buy) => Math.abs((buy.quantity ?? 0) - (sell.quantity ?? 0)) < 1e-12);
}

function closedTrades(sells: CryptoJournalEntry[], buys: CryptoJournalEntry[]): PaperClosedTrade[] {
  return sells
    .map((sell) => {
      const cost = estimatedCosts(sell);
      const net = sell.realizedPnlUsdt ?? 0;
      const buy = matchingBuy(sell, buys);
      const holdMinutes = buy ? Math.round((Date.parse(sell.timestamp) - Date.parse(buy.timestamp)) / 60_000) : undefined;
      return {
        symbol: sell.symbol,
        timestamp: sell.timestamp,
        reason: exitReason(sell),
        netPnlUsdt: net,
        grossPnlUsdt: net + cost,
        estimatedCostsUsdt: cost,
        holdMinutes,
        entryPrice: buy?.price,
        exitPrice: sell.price
      };
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

function summarizeGroup(trades: PaperClosedTrade[]): PaperReportGroup {
  const netPnlUsdt = trades.reduce((sum, trade) => sum + trade.netPnlUsdt, 0);
  const grossPnlUsdt = trades.reduce((sum, trade) => sum + trade.grossPnlUsdt, 0);
  const estimatedCostsUsdt = trades.reduce((sum, trade) => sum + trade.estimatedCostsUsdt, 0);
  const wins = trades.filter((trade) => trade.netPnlUsdt > 0).length;
  const totalHold = trades.reduce((sum, trade) => sum + (trade.holdMinutes ?? 0), 0);
  return {
    trades: trades.length,
    wins,
    winRatePct: trades.length > 0 ? round((wins / trades.length) * 100, 1) : 0,
    netPnlUsdt: round(netPnlUsdt),
    grossPnlUsdt: round(grossPnlUsdt),
    estimatedCostsUsdt: round(estimatedCostsUsdt),
    avgHoldMinutes: trades.length > 0 ? round(totalHold / trades.length, 1) : 0
  };
}

function groupedBy(trades: PaperClosedTrade[], key: keyof Pick<PaperClosedTrade, "reason" | "symbol">): Record<string, PaperReportGroup> {
  const buckets = new Map<string, PaperClosedTrade[]>();
  for (const trade of trades) {
    const bucket = buckets.get(trade[key]) ?? [];
    bucket.push(trade);
    buckets.set(trade[key], bucket);
  }
  return Object.fromEntries(Array.from(buckets.entries()).map(([name, rows]) => [name, summarizeGroup(rows)]));
}

function buildRecommendations(totals: PaperReport["totals"], byExitReason: Record<string, PaperReportGroup>): string[] {
  const recommendations: string[] = [];
  if (totals.estimatedCostsUsdt > Math.abs(totals.grossPnlUsdt)) {
    recommendations.push("Cost drag is larger than the gross edge; reduce churn or require a wider expected move before entry.");
  }
  if ((byExitReason.stop_loss?.netPnlUsdt ?? 0) < 0) {
    recommendations.push("Stop-loss exits are a major loss source; review entries that fail within the first 30-40 minutes.");
  }
  if ((byExitReason.signal_exit?.netPnlUsdt ?? 0) < 0) {
    recommendations.push("Signal exits are cutting losers after entry; consider tightening the entry filter instead of relying on signal_exit cleanup.");
  }
  if ((byExitReason.timeout?.grossPnlUsdt ?? 0) > 0 && (byExitReason.timeout?.netPnlUsdt ?? 0) < 0) {
    recommendations.push("Timeout trades are gross-positive but net-negative; the average move is too small after fees and slippage.");
  }
  return recommendations.length > 0 ? recommendations : ["No dominant loss source yet; keep collecting more paper samples."];
}

export function buildPaperReport(entries: CryptoJournalEntry[], options: PaperReportOptions): PaperReport {
  const now = options.now ?? new Date();
  const windowHours = options.windowHours ?? 24;
  const cutoff = now.getTime() - windowHours * 60 * 60 * 1000;
  const paperEntries = entries.filter((entry) => entry.mode === "paper" || entry.mode === undefined);
  const windowEntries = paperEntries.filter((entry) => Date.parse(entry.timestamp) >= cutoff);
  const allBuys = paperEntries.filter((entry) => entry.side === "BUY");
  const windowSells = windowEntries.filter((entry) => entry.side === "SELL");
  const trades = closedTrades(windowSells, allBuys);
  const openBuys = paperEntries.filter((entry) => entry.side === "BUY" && entry.open);
  const openCostUsdt = openBuys.reduce((sum, entry) => sum + (entry.quoteQty ?? 0), 0);
  const lifetimeRealizedPnlUsdt = paperEntries
    .filter((entry) => entry.side === "SELL")
    .reduce((sum, entry) => sum + (entry.realizedPnlUsdt ?? 0), 0);
  const totalsBase = summarizeGroup(trades);
  const grossWins = trades.filter((trade) => trade.grossPnlUsdt > 0).length;
  const byExitReason = groupedBy(trades, "reason");
  const totals = {
    ...totalsBase,
    closedTrades: trades.length,
    openPositions: openBuys.length,
    openCostUsdt: round(openCostUsdt),
    lifetimeRealizedPnlUsdt: round(lifetimeRealizedPnlUsdt),
    cashUsdt: round(options.initialCapitalUsdt + lifetimeRealizedPnlUsdt - openCostUsdt),
    equityAtCostUsdt: round(options.initialCapitalUsdt + lifetimeRealizedPnlUsdt),
    costShareOfLossPct: totalsBase.netPnlUsdt < 0 ? round((totalsBase.estimatedCostsUsdt / Math.abs(totalsBase.netPnlUsdt)) * 100, 1) : 0,
    grossWinRatePct: trades.length > 0 ? round((grossWins / trades.length) * 100, 1) : 0
  };
  return {
    generatedAt: now.toISOString(),
    windowHours,
    totals,
    byExitReason,
    bySymbol: groupedBy(trades, "symbol"),
    recentClosed: trades.slice(0, 10).map((trade) => ({
      ...trade,
      netPnlUsdt: round(trade.netPnlUsdt),
      grossPnlUsdt: round(trade.grossPnlUsdt),
      estimatedCostsUsdt: round(trade.estimatedCostsUsdt)
    })),
    recommendations: buildRecommendations(totals, byExitReason)
  };
}

function formatGroup(name: string, group: PaperReportGroup): string {
  return `- ${name}: trades=${group.trades}, win=${group.winRatePct}%, net=${group.netPnlUsdt}U, gross=${group.grossPnlUsdt}U, costs=${group.estimatedCostsUsdt}U, avgHold=${group.avgHoldMinutes}m`;
}

export function formatPaperReport(report: PaperReport): string {
  const lines = [
    `# Paper Trading Report ${report.generatedAt}`,
    "",
    `Window: last ${report.windowHours}h`,
    `Closed trades: ${report.totals.closedTrades}`,
    `Open positions: ${report.totals.openPositions}`,
    `Net PnL: ${report.totals.netPnlUsdt}U`,
    `Gross PnL before costs: ${report.totals.grossPnlUsdt}U`,
    `Estimated costs: ${report.totals.estimatedCostsUsdt}U`,
    `Cost drag: ${report.totals.costShareOfLossPct}% of net loss`,
    `Net win rate: ${report.totals.winRatePct}%`,
    `Gross win rate: ${report.totals.grossWinRatePct}%`,
    `Lifetime realized PnL: ${report.totals.lifetimeRealizedPnlUsdt}U`,
    `Cash at cost: ${report.totals.cashUsdt}U`,
    `Equity at cost: ${report.totals.equityAtCostUsdt}U`,
    "",
    "## Exit Reasons",
    ...Object.entries(report.byExitReason).map(([name, group]) => formatGroup(name, group)),
    "",
    "## Symbols",
    ...Object.entries(report.bySymbol).map(([name, group]) => formatGroup(name, group)),
    "",
    "## Recommendations",
    ...report.recommendations.map((item) => `- ${item}`),
    "",
    "## Recent Closed Trades",
    ...report.recentClosed.map(
      (trade) =>
        `- ${trade.timestamp} ${trade.symbol} ${trade.reason}: net=${trade.netPnlUsdt}U, gross=${trade.grossPnlUsdt}U, costs=${trade.estimatedCostsUsdt}U, hold=${trade.holdMinutes ?? "?"}m`
    )
  ];
  return `${lines.join("\n")}\n`;
}
