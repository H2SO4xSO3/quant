import type { CryptoExecutionMode, CryptoJournalEntry } from "./types";

export interface DailyReviewSourceInput {
  id: string;
  label: string;
  mode: Extract<CryptoExecutionMode, "paper" | "futures_paper">;
  initialCapitalUsdt: number;
  entries: CryptoJournalEntry[];
}

export interface DailyReviewOptions {
  now?: Date;
  windowHours?: number;
}

export interface DailyReviewChanLabel {
  label: string;
  trend: string;
  strokes: number;
  pivot: string;
  position: string;
  divergence: string;
  setup: string;
}

export interface DailyReviewClosedTrade {
  sourceId: string;
  symbol: string;
  direction: "long" | "short";
  timestamp: string;
  reason: string;
  netPnlUsdt: number;
  grossPnlUsdt: number;
  estimatedCostsUsdt: number;
  holdMinutes?: number;
  leverage?: number;
  chan?: DailyReviewChanLabel;
}

export interface DailyReviewGroup {
  closedTrades: number;
  wins: number;
  winRatePct: number;
  netPnlUsdt: number;
  grossPnlUsdt: number;
  estimatedCostsUsdt: number;
  openPositions: number;
  openExposureUsdt: number;
  liquidations: number;
  stopLosses: number;
  takeProfits: number;
  avgHoldMinutes: number;
}

export interface DailyReviewSourceReport extends DailyReviewGroup {
  id: string;
  label: string;
  mode: DailyReviewSourceInput["mode"];
  initialCapitalUsdt: number;
  equityUsdt: number;
  returnPct: number;
  rootCauses: string[];
}

export interface DailyStrategyReview {
  generatedAt: string;
  windowHours: number;
  totals: DailyReviewGroup;
  sources: Record<string, DailyReviewSourceReport>;
  byExitReason: Record<string, DailyReviewGroup>;
  recentClosed: DailyReviewClosedTrade[];
  findings: string[];
  hypotheses: string[];
  riskDebate: {
    aggressive: string;
    conservative: string;
    operatorDecision: string;
  };
}

const PAPER_COST_PATTERN = /^Estimated paper costs (-?[0-9.]+)U/;
const FUTURES_COST_PATTERN = /^Estimated futures costs (-?[0-9.]+)U/;
const FUTURES_GROSS_PATTERN = /^Gross futures PnL (-?[0-9.]+)U/;
const CHAN_LABEL_PATTERN = /^Chan trend=([^ ]+) strokes=(\d+) pivot=([^ ]+) position=([^ ]+) divergence=([^ ]+) setup=([^ ]+)$/;

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function parseNoteNumber(notes: string[] | undefined, pattern: RegExp): number | undefined {
  const match = notes?.map((note) => note.match(pattern)).find(Boolean);
  return match ? Number(match[1]) : undefined;
}

function estimatedCosts(entry: CryptoJournalEntry): number {
  return parseNoteNumber(entry.notes, entry.mode === "futures_paper" ? FUTURES_COST_PATTERN : PAPER_COST_PATTERN) ?? 0;
}

function grossPnl(entry: CryptoJournalEntry): number {
  const futuresGross = parseNoteNumber(entry.notes, FUTURES_GROSS_PATTERN);
  if (futuresGross !== undefined) {
    return futuresGross;
  }
  return (entry.realizedPnlUsdt ?? 0) + estimatedCosts(entry);
}

function exitReason(entry: CryptoJournalEntry): string {
  const note = entry.notes?.[0] ?? "";
  return (
    note
      .replace(/^Paper /, "")
      .replace(/^Futures paper /, "")
      .replace(/ exit$/, "") || "unknown"
  );
}
function parseChanLabel(notes: string[] | undefined): DailyReviewChanLabel | undefined {
  const note = notes?.find((item) => item.startsWith("Chan "));
  const match = note?.match(CHAN_LABEL_PATTERN);
  if (!match || !note) {
    return undefined;
  }
  return {
    label: note,
    trend: match[1],
    strokes: Number(match[2]),
    pivot: match[3],
    position: match[4],
    divergence: match[5],
    setup: match[6]
  };
}

function isClosingEntry(entry: CryptoJournalEntry, mode: DailyReviewSourceInput["mode"]): boolean {
  if (entry.open) {
    return false;
  }
  if (mode === "futures_paper") {
    const direction = entry.direction ?? "long";
    return entry.mode === "futures_paper" && (direction === "long" ? entry.side === "SELL" : entry.side === "BUY");
  }
  return (entry.mode === "paper" || entry.mode === undefined) && entry.side === "SELL";
}

function isOpeningEntry(entry: CryptoJournalEntry, mode: DailyReviewSourceInput["mode"]): boolean {
  if (mode === "futures_paper") {
    const direction = entry.direction ?? "long";
    return entry.mode === "futures_paper" && (direction === "long" ? entry.side === "BUY" : entry.side === "SELL");
  }
  return (entry.mode === "paper" || entry.mode === undefined) && entry.side === "BUY";
}

function matchingOpen(close: CryptoJournalEntry, opens: CryptoJournalEntry[]): CryptoJournalEntry | undefined {
  return opens
    .filter((open) => open.symbol === close.symbol && (open.direction ?? "long") === (close.direction ?? "long"))
    .filter((open) => Date.parse(open.timestamp) <= Date.parse(close.timestamp))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .find((open) => Math.abs((open.quantity ?? 0) - (close.quantity ?? 0)) < 1e-12);
}

function toClosedTrades(source: DailyReviewSourceInput, cutoff: number): DailyReviewClosedTrade[] {
  const sourceEntries = source.entries.filter((entry) => source.mode === "futures_paper" ? entry.mode === "futures_paper" : entry.mode === "paper" || entry.mode === undefined);
  const opens = sourceEntries.filter((entry) => isOpeningEntry(entry, source.mode));
  return sourceEntries
    .filter((entry) => Date.parse(entry.timestamp) >= cutoff)
    .filter((entry) => isClosingEntry(entry, source.mode))
    .map((entry) => {
      const open = matchingOpen(entry, opens);
      const holdMinutes = open ? Math.round((Date.parse(entry.timestamp) - Date.parse(open.timestamp)) / 60_000) : undefined;
      return {
        sourceId: source.id,
        symbol: entry.symbol,
        direction: entry.direction ?? "long",
        timestamp: entry.timestamp,
        reason: exitReason(entry),
        netPnlUsdt: entry.realizedPnlUsdt ?? 0,
        grossPnlUsdt: grossPnl(entry),
        estimatedCostsUsdt: estimatedCosts(entry),
        holdMinutes,
        leverage: entry.leverage,
        chan: parseChanLabel(open?.notes)
      };
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

function emptyGroup(): DailyReviewGroup {
  return {
    closedTrades: 0,
    wins: 0,
    winRatePct: 0,
    netPnlUsdt: 0,
    grossPnlUsdt: 0,
    estimatedCostsUsdt: 0,
    openPositions: 0,
    openExposureUsdt: 0,
    liquidations: 0,
    stopLosses: 0,
    takeProfits: 0,
    avgHoldMinutes: 0
  };
}

function summarizeTrades(trades: DailyReviewClosedTrade[], openEntries: CryptoJournalEntry[] = []): DailyReviewGroup {
  const netPnlUsdt = trades.reduce((sum, trade) => sum + trade.netPnlUsdt, 0);
  const grossPnlUsdt = trades.reduce((sum, trade) => sum + trade.grossPnlUsdt, 0);
  const estimatedCostsUsdt = trades.reduce((sum, trade) => sum + trade.estimatedCostsUsdt, 0);
  const wins = trades.filter((trade) => trade.netPnlUsdt > 0).length;
  const holdSamples = trades.filter((trade) => trade.holdMinutes !== undefined);
  const totalHoldMinutes = holdSamples.reduce((sum, trade) => sum + (trade.holdMinutes ?? 0), 0);

  return {
    ...emptyGroup(),
    closedTrades: trades.length,
    wins,
    winRatePct: trades.length > 0 ? round((wins / trades.length) * 100, 1) : 0,
    netPnlUsdt: round(netPnlUsdt),
    grossPnlUsdt: round(grossPnlUsdt),
    estimatedCostsUsdt: round(estimatedCostsUsdt),
    openPositions: openEntries.length,
    openExposureUsdt: round(openEntries.reduce((sum, entry) => sum + (entry.notionalUsdt ?? entry.marginUsdt ?? entry.quoteQty ?? 0), 0)),
    liquidations: trades.filter((trade) => trade.reason === "liquidation").length,
    stopLosses: trades.filter((trade) => trade.reason === "stop_loss").length,
    takeProfits: trades.filter((trade) => trade.reason === "take_profit").length,
    avgHoldMinutes: holdSamples.length > 0 ? round(totalHoldMinutes / holdSamples.length, 1) : 0
  };
}

function rootCauses(group: DailyReviewGroup, trades: DailyReviewClosedTrade[]): string[] {
  const causes: string[] = [];
  if (group.liquidations > 0) {
    causes.push("liquidation_risk");
  }
  if (group.stopLosses > 0 && group.netPnlUsdt < 0) {
    causes.push("entry_quality_stop_loss");
  }
  if (trades.some((trade) => trade.grossPnlUsdt > 0 && trade.netPnlUsdt <= 0 && trade.estimatedCostsUsdt >= trade.grossPnlUsdt)) {
    causes.push("cost_drag");
  }
  const losingTrades = trades.filter((trade) => trade.netPnlUsdt < 0);
  if (losingTrades.some((trade) => trade.chan?.setup === "center_chop")) {
    causes.push("chan_center_chop");
  }
  if (losingTrades.some((trade) => (trade.direction === "long" && trade.chan?.trend === "down") || (trade.direction === "short" && trade.chan?.trend === "up"))) {
    causes.push("chan_counter_trend");
  }
  if (group.closedTrades === 0) {
    causes.push("no_signal_sample");
  }
  if (causes.length === 0 && group.netPnlUsdt < 0) {
    causes.push("negative_edge_after_costs");
  }
  return causes.length > 0 ? causes : ["sample_ok_keep_collecting"];
}

function groupByReason(trades: DailyReviewClosedTrade[]): Record<string, DailyReviewGroup> {
  const buckets = new Map<string, DailyReviewClosedTrade[]>();
  for (const trade of trades) {
    const next = buckets.get(trade.reason) ?? [];
    next.push(trade);
    buckets.set(trade.reason, next);
  }
  return Object.fromEntries(Array.from(buckets.entries()).map(([reason, rows]) => [reason, summarizeTrades(rows)]));
}

function buildFindings(sources: Record<string, DailyReviewSourceReport>, totals: DailyReviewGroup, byExitReason: Record<string, DailyReviewGroup>): string[] {
  const findings: string[] = [];
  const worst = Object.values(sources).sort((a, b) => a.netPnlUsdt - b.netPnlUsdt)[0];
  if (worst) {
    findings.push(`${worst.id} is the main drag: net=${worst.netPnlUsdt}U, gross=${worst.grossPnlUsdt}U, costs=${worst.estimatedCostsUsdt}U, causes=${worst.rootCauses.join(",")}.`);
  }
  if (totals.grossPnlUsdt > 0 && totals.netPnlUsdt <= 0) {
    findings.push(`Gross edge is positive but net is not: gross=${totals.grossPnlUsdt}U, costs=${totals.estimatedCostsUsdt}U.`);
  }
  if (totals.liquidations > 0) {
    findings.push(`Liquidation occurred ${totals.liquidations} time(s); leverage is amplifying small adverse moves into full-margin losses.`);
  }
  if (totals.stopLosses > totals.takeProfits) {
    findings.push(`Stop losses outnumber take profits: stopLosses=${totals.stopLosses}, takeProfits=${totals.takeProfits}.`);
  }
  const timeoutTrades = byExitReason.timeout?.closedTrades ?? 0;
  if (totals.closedTrades > 0 && timeoutTrades / totals.closedTrades >= 0.5 && totals.grossPnlUsdt > 0 && totals.netPnlUsdt <= 0) {
    findings.push("Timeout exits dominate recent futures paper results; treat this as exit-quality risk, not proof of take-profit edge.");
  }
  return findings.length > 0 ? findings : ["No dominant failure mode yet; keep collecting paper samples."];
}

function buildHypotheses(totals: DailyReviewGroup, trades: DailyReviewClosedTrade[]): string[] {
  const hypotheses: string[] = [];
  if (totals.liquidations > 0) {
    hypotheses.push("Run a leverage A/B: keep 20x/30x isolated paper, but add a lower-leverage 5x or 10x comparator to measure whether liquidation risk dominates expected edge.");
  }
  if (totals.stopLosses > 0) {
    hypotheses.push("Test a strategy-level entry confirmation: require value-area reclaim or breakdown retest before entry, then compare stop_loss rate and average hold time.");
  }
  if (totals.grossPnlUsdt > 0 && totals.netPnlUsdt <= 0) {
    hypotheses.push("Test a cost-aware target filter: only enter when expected gross move is at least three times estimated round-trip friction.");
  }
  if (trades.some((trade) => trade.netPnlUsdt < 0 && trade.chan?.setup === "center_chop")) {
    hypotheses.push("Test a Chan center filter: avoid opening inside pivot chop unless another signal confirms expansion out of the center.");
  }
  if (trades.some((trade) => trade.netPnlUsdt < 0 && ((trade.direction === "long" && trade.chan?.trend === "down") || (trade.direction === "short" && trade.chan?.trend === "up")))) {
    hypotheses.push("Test a Chan trend filter: block entries against the latest completed stroke trend until a lower-level divergence confirms reversal.");
  }
  if (hypotheses.length === 0) {
    hypotheses.push("No strategy change yet; require more closed trades before changing rules.");
  }
  return hypotheses;
}

function buildRiskDebate(totals: DailyReviewGroup, findings: string[] = []): DailyStrategyReview["riskDebate"] {
  const observeOnly = totals.netPnlUsdt <= 0 || findings.some((finding) => finding.includes("Timeout exits dominate"));
  return {
    aggressive: totals.grossPnlUsdt > 0
      ? "Gross PnL shows some signal; keep the unified 50x paper strategy running to collect more long/short samples."
      : "Unified 50x strategy has not shown gross edge yet; keep it paper-only until closed-trade evidence exists.",
    conservative: totals.netPnlUsdt < 0
      ? "Net PnL is negative after costs and losses; do not promote any branch, and treat leverage as an experiment variable."
      : "Net PnL is non-negative, but sample size and drawdown still decide whether this is repeatable.",
    operatorDecision: observeOnly
      ? "Keep this as paper-only observe_only research until net PnL, exit quality, and sample size improve."
      : "Keep this as paper-only research. Next change must be a strategy hypothesis with before/after evidence, not a silent threshold tweak."
  };
}

export function buildDailyStrategyReview(sourceInputs: DailyReviewSourceInput[], options: DailyReviewOptions = {}): DailyStrategyReview {
  const now = options.now ?? new Date();
  const windowHours = options.windowHours ?? 24;
  const cutoff = now.getTime() - windowHours * 60 * 60 * 1000;
  const allTrades = sourceInputs.flatMap((source) => toClosedTrades(source, cutoff));
  const sources: Record<string, DailyReviewSourceReport> = {};

  for (const source of sourceInputs) {
    const sourceTrades = allTrades.filter((trade) => trade.sourceId === source.id);
    const openEntries = source.entries.filter((entry) => entry.open);
    const summary = summarizeTrades(sourceTrades, openEntries);
    const lifetimeRealizedPnlUsdt = source.entries
      .filter((entry) => isClosingEntry(entry, source.mode))
      .reduce((sum, entry) => sum + (entry.realizedPnlUsdt ?? 0), 0);
    const equityUsdt = source.initialCapitalUsdt + lifetimeRealizedPnlUsdt;
    sources[source.id] = {
      id: source.id,
      label: source.label,
      mode: source.mode,
      initialCapitalUsdt: source.initialCapitalUsdt,
      ...summary,
      equityUsdt: round(equityUsdt),
      returnPct: source.initialCapitalUsdt > 0 ? round(((equityUsdt - source.initialCapitalUsdt) / source.initialCapitalUsdt) * 100, 3) : 0,
      rootCauses: rootCauses(summary, sourceTrades)
    };
  }

  const totals = summarizeTrades(allTrades, sourceInputs.flatMap((source) => source.entries.filter((entry) => entry.open)));
  const byExitReason = groupByReason(allTrades);
  const findings = buildFindings(sources, totals, byExitReason);
  return {
    generatedAt: now.toISOString(),
    windowHours,
    totals,
    sources,
    byExitReason,
    recentClosed: allTrades.slice(0, 12).map((trade) => ({
      ...trade,
      netPnlUsdt: round(trade.netPnlUsdt),
      grossPnlUsdt: round(trade.grossPnlUsdt),
      estimatedCostsUsdt: round(trade.estimatedCostsUsdt)
    })),
    findings,
    hypotheses: buildHypotheses(totals, allTrades),
    riskDebate: buildRiskDebate(totals, findings)
  };
}

function formatGroup(id: string, group: DailyReviewGroup): string {
  return `- ${id}: trades=${group.closedTrades}, win=${group.winRatePct}%, net=${group.netPnlUsdt}U, gross=${group.grossPnlUsdt}U, costs=${group.estimatedCostsUsdt}U, open=${group.openPositions}, liq=${group.liquidations}, stop=${group.stopLosses}, tp=${group.takeProfits}, avgHold=${group.avgHoldMinutes}m`;
}

export function formatDailyStrategyReview(review: DailyStrategyReview): string {
  const lines = [
    `# Daily Strategy Review ${review.generatedAt}`,
    "",
    `Window: last ${review.windowHours}h`,
    `Closed trades: ${review.totals.closedTrades}`,
    `Open positions: ${review.totals.openPositions}`,
    `Net PnL: ${review.totals.netPnlUsdt}U`,
    `Gross PnL before costs: ${review.totals.grossPnlUsdt}U`,
    `Estimated costs: ${review.totals.estimatedCostsUsdt}U`,
    `Liquidations: ${review.totals.liquidations}`,
    "",
    "## Sources",
    ...Object.values(review.sources).map((source) => `${formatGroup(source.id, source)} equity=${source.equityUsdt}U return=${source.returnPct}% causes=${source.rootCauses.join(",")}`),
    "",
    "## Exit Reasons",
    ...Object.entries(review.byExitReason).map(([reason, group]) => formatGroup(reason, group)),
    "",
    "## Root Causes",
    ...review.findings.map((finding) => `- ${finding}`),
    "",
    "## Strategy Hypotheses",
    ...review.hypotheses.map((hypothesis) => `- ${hypothesis}`),
    "",
    "## Risk Debate",
    `- Aggressive: ${review.riskDebate.aggressive}`,
    `- Conservative: ${review.riskDebate.conservative}`,
    `- Decision: ${review.riskDebate.operatorDecision}`,
    "",
    "## Recent Closed Trades",
    ...review.recentClosed.map(
      (trade) =>
        `- ${trade.timestamp} ${trade.sourceId} ${trade.symbol} ${trade.direction} ${trade.reason}: net=${trade.netPnlUsdt}U, gross=${trade.grossPnlUsdt}U, costs=${trade.estimatedCostsUsdt}U, hold=${trade.holdMinutes ?? "?"}m${trade.chan ? `, chan=trend=${trade.chan.trend}/setup=${trade.chan.setup}/position=${trade.chan.position}` : ""}`
    )
  ];
  return `${lines.join("\n")}\n`;
}
