export type VolumeWatchDirection = "long_watch" | "short_watch";

export interface ScoreObservation {
  symbol: string;
  timestampMs: number;
  direction: VolumeWatchDirection;
  rawScore: number;
}

export interface SignalEvent extends ScoreObservation {
  threshold: number;
}

export interface ResearchPriceBar {
  symbol: string;
  openTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LabeledSignalEvent extends SignalEvent {
  horizonMinutes: number;
  roundTripCostPct: number;
  status: "completed" | "pending";
  pendingReason?: "entry_missing" | "horizon_incomplete";
  entryTimeMs?: number;
  exitTimeMs?: number;
  entryPrice?: number;
  exitPrice?: number;
  grossDirectionalReturnPct?: number;
  netDirectionalReturnPct?: number;
  mfePct?: number;
  maePct?: number;
}

export interface LabeledEventSummary {
  completed: number;
  pending: number;
  meanNetReturnPct: number | null;
  medianNetReturnPct: number | null;
  winRatePct: number | null;
  profitFactor: number | null;
  meanCi95Pct: [number, number] | null;
  meanMfePct: number | null;
  meanMaePct: number | null;
}

export interface PrimaryResearchCell {
  horizonMinutes: number;
  completed: number;
  signalMinusBaselineMeanPct: number | null;
  excessMeanCi95Pct: [number, number] | null;
}

export interface VolumeSignalResearchGrade {
  action: "hold";
  rawScore: number;
  state: "no_trade" | "observe_only";
  blocked: "sample_too_small" | "weak_forward_edge" | "paper_evidence_missing";
  evidence: string;
  nextCheck: string;
}

export interface ReturnSampleComparison {
  signalCount: number;
  baselineCount: number;
  signalMeanPct: number | null;
  signalMedianPct: number | null;
  baselineMeanPct: number | null;
  baselineMedianPct: number | null;
  signalMinusBaselineMeanPct: number | null;
  excessMeanCi95Pct: [number, number] | null;
}

function round(value: number, decimals = 8): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function extractThresholdCrossings(
  observations: ScoreObservation[],
  threshold: number,
  cooldownMinutes: number
): SignalEvent[] {
  const states = new Map<string, { above: boolean; lastAcceptedMs: number }>();
  const events: SignalEvent[] = [];

  for (const observation of [...observations].sort((left, right) => left.timestampMs - right.timestampMs)) {
    const symbol = observation.symbol;
    const state = states.get(symbol) ?? { above: false, lastAcceptedMs: Number.NEGATIVE_INFINITY };
    const above = observation.rawScore >= threshold;
    const crossed = above && !state.above;

    if (crossed && observation.timestampMs - state.lastAcceptedMs >= cooldownMinutes * 60_000) {
      events.push({ ...observation, symbol, threshold });
      state.lastAcceptedMs = observation.timestampMs;
    }

    state.above = above;
    states.set(symbol, state);
  }

  return events;
}

export function labelSignalEvents(options: {
  events: SignalEvent[];
  bars: ResearchPriceBar[];
  horizonMinutes: number;
  roundTripCostPct: number;
}): LabeledSignalEvent[] {
  const barsBySymbol = new Map<string, ResearchPriceBar[]>();
  for (const bar of options.bars) {
    const symbol = bar.symbol.toUpperCase();
    barsBySymbol.set(symbol, [...(barsBySymbol.get(symbol) ?? []), { ...bar, symbol }]);
  }
  for (const rows of barsBySymbol.values()) {
    rows.sort((left, right) => left.openTimeMs - right.openTimeMs);
  }

  return options.events.map((event) => {
    const base = {
      ...event,
      symbol: event.symbol.toUpperCase(),
      horizonMinutes: options.horizonMinutes,
      roundTripCostPct: options.roundTripCostPct
    };
    const bars = barsBySymbol.get(base.symbol) ?? [];
    const entryIndex = bars.findIndex((bar) => bar.openTimeMs > event.timestampMs);
    if (entryIndex < 0) {
      return { ...base, status: "pending", pendingReason: "entry_missing" };
    }

    const entry = bars[entryIndex];
    const targetExitMs = entry.openTimeMs + options.horizonMinutes * 60_000;
    const exitIndex = bars.findIndex((bar, index) => index > entryIndex && bar.openTimeMs >= targetExitMs);
    if (exitIndex < 0) {
      return {
        ...base,
        status: "pending",
        pendingReason: "horizon_incomplete",
        entryTimeMs: entry.openTimeMs,
        entryPrice: entry.open
      };
    }

    const exit = bars[exitIndex];
    const priceReturnPct = ((exit.open - entry.open) / entry.open) * 100;
    const direction = event.direction === "long_watch" ? 1 : -1;
    const excursionBars = bars.slice(entryIndex, exitIndex);
    const favorable = excursionBars.map((bar) =>
      direction === 1 ? ((bar.high - entry.open) / entry.open) * 100 : ((entry.open - bar.low) / entry.open) * 100
    );
    const adverse = excursionBars.map((bar) =>
      direction === 1 ? ((bar.low - entry.open) / entry.open) * 100 : ((entry.open - bar.high) / entry.open) * 100
    );
    const grossDirectionalReturnPct = round(priceReturnPct * direction);

    return {
      ...base,
      status: "completed",
      entryTimeMs: entry.openTimeMs,
      exitTimeMs: exit.openTimeMs,
      entryPrice: entry.open,
      exitPrice: exit.open,
      grossDirectionalReturnPct,
      netDirectionalReturnPct: round(grossDirectionalReturnPct - options.roundTripCostPct),
      mfePct: round(Math.max(...favorable)),
      maePct: round(Math.min(...adverse))
    };
  });
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function bootstrapMeanCi(values: number[], iterations = 5_000): [number, number] | null {
  if (values.length < 2) {
    return null;
  }
  let seed = 20_260_713;
  const nextIndex = (): number => {
    seed = (1_664_525 * seed + 1_013_904_223) >>> 0;
    return Math.floor((seed / 2 ** 32) * values.length);
  };
  const means: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = Array.from({ length: values.length }, () => values[nextIndex()]);
    means.push(mean(sample));
  }
  means.sort((left, right) => left - right);
  return [round(means[Math.floor((means.length - 1) * 0.025)], 4), round(means[Math.floor((means.length - 1) * 0.975)], 4)];
}

export function summarizeLabeledEvents(labels: LabeledSignalEvent[]): LabeledEventSummary {
  const completed = labels.filter(
    (label): label is LabeledSignalEvent & { netDirectionalReturnPct: number; mfePct: number; maePct: number } =>
      label.status === "completed" &&
      label.netDirectionalReturnPct !== undefined &&
      label.mfePct !== undefined &&
      label.maePct !== undefined
  );
  const returns = completed.map((label) => label.netDirectionalReturnPct);
  if (returns.length === 0) {
    return {
      completed: 0,
      pending: labels.length,
      meanNetReturnPct: null,
      medianNetReturnPct: null,
      winRatePct: null,
      profitFactor: null,
      meanCi95Pct: null,
      meanMfePct: null,
      meanMaePct: null
    };
  }
  const gains = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));

  return {
    completed: completed.length,
    pending: labels.length - completed.length,
    meanNetReturnPct: round(mean(returns), 4),
    medianNetReturnPct: round(median(returns), 4),
    winRatePct: round((returns.filter((value) => value > 0).length / returns.length) * 100, 2),
    profitFactor: losses === 0 ? null : round(gains / losses, 4),
    meanCi95Pct: bootstrapMeanCi(returns),
    meanMfePct: round(mean(completed.map((label) => label.mfePct)), 4),
    meanMaePct: round(mean(completed.map((label) => label.maePct)), 4)
  };
}

export function gradeVolumeSignalResearch(options: {
  latestRawScores: Record<string, number>;
  primaryCells: PrimaryResearchCell[];
}): VolumeSignalResearchGrade {
  const rawScore = Math.max(0, ...Object.values(options.latestRawScores));
  const completedMax = Math.max(0, ...options.primaryCells.map((cell) => cell.completed));
  if (completedMax < 30) {
    return {
      action: "hold",
      rawScore,
      state: "no_trade",
      blocked: "sample_too_small",
      evidence: `primary_threshold=70 completed_max=${completedMax} required=30`,
      nextCheck: "collect more independent threshold-70 events"
    };
  }

  const robustHorizons = options.primaryCells.filter(
    (cell) =>
      cell.completed >= 30 &&
      (cell.signalMinusBaselineMeanPct ?? 0) > 0 &&
      cell.excessMeanCi95Pct !== null &&
      cell.excessMeanCi95Pct[0] > 0
  );
  if (robustHorizons.length >= 3) {
    return {
      action: "hold",
      rawScore,
      state: "observe_only",
      blocked: "paper_evidence_missing",
      evidence: `primary_threshold=70 robust_horizons=${robustHorizons.length}/4`,
      nextCheck: "run forward paper observation before any execution gate"
    };
  }

  return {
    action: "hold",
    rawScore,
    state: "no_trade",
    blocked: "weak_forward_edge",
    evidence: "primary threshold-70 evidence did not pass robustness gates",
    nextCheck: "inspect net excess returns and confidence intervals"
  };
}

export function buildNonOverlappingBaselineReturns(options: {
  bars: ResearchPriceBar[];
  symbol: string;
  direction: VolumeWatchDirection;
  horizonMinutes: number;
  roundTripCostPct: number;
  startTimeMs: number;
  endTimeMs: number;
}): number[] {
  const symbol = options.symbol.toUpperCase();
  const bars = options.bars
    .filter((bar) => bar.symbol.toUpperCase() === symbol && bar.openTimeMs >= options.startTimeMs && bar.openTimeMs <= options.endTimeMs)
    .sort((left, right) => left.openTimeMs - right.openTimeMs);
  const horizonMs = options.horizonMinutes * 60_000;
  const direction = options.direction === "long_watch" ? 1 : -1;
  const returns: number[] = [];
  let entryIndex = 0;

  while (entryIndex < bars.length) {
    const entry = bars[entryIndex];
    const exitIndex = bars.findIndex((bar, index) => index > entryIndex && bar.openTimeMs >= entry.openTimeMs + horizonMs);
    if (exitIndex < 0) {
      break;
    }
    const exit = bars[exitIndex];
    const gross = ((exit.open - entry.open) / entry.open) * 100 * direction;
    returns.push(round(gross - options.roundTripCostPct));
    entryIndex = exitIndex;
  }

  return returns;
}

export function compareReturnSamples(signalReturns: number[], baselineReturns: number[], iterations = 5_000): ReturnSampleComparison {
  if (signalReturns.length === 0 || baselineReturns.length === 0) {
    return {
      signalCount: signalReturns.length,
      baselineCount: baselineReturns.length,
      signalMeanPct: signalReturns.length ? round(mean(signalReturns), 4) : null,
      signalMedianPct: signalReturns.length ? round(median(signalReturns), 4) : null,
      baselineMeanPct: baselineReturns.length ? round(mean(baselineReturns), 4) : null,
      baselineMedianPct: baselineReturns.length ? round(median(baselineReturns), 4) : null,
      signalMinusBaselineMeanPct: null,
      excessMeanCi95Pct: null
    };
  }

  let seed = 20_260_713;
  const nextIndex = (length: number): number => {
    seed = (1_664_525 * seed + 1_013_904_223) >>> 0;
    return Math.floor((seed / 2 ** 32) * length);
  };
  const differences: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const signalSample = Array.from({ length: signalReturns.length }, () => signalReturns[nextIndex(signalReturns.length)]);
    const baselineSample = Array.from({ length: baselineReturns.length }, () => baselineReturns[nextIndex(baselineReturns.length)]);
    differences.push(mean(signalSample) - mean(baselineSample));
  }
  differences.sort((left, right) => left - right);
  const signalMean = mean(signalReturns);
  const baselineMean = mean(baselineReturns);

  return {
    signalCount: signalReturns.length,
    baselineCount: baselineReturns.length,
    signalMeanPct: round(signalMean, 4),
    signalMedianPct: round(median(signalReturns), 4),
    baselineMeanPct: round(baselineMean, 4),
    baselineMedianPct: round(median(baselineReturns), 4),
    signalMinusBaselineMeanPct: round(signalMean - baselineMean, 4),
    excessMeanCi95Pct: [
      round(differences[Math.floor((differences.length - 1) * 0.025)], 4),
      round(differences[Math.floor((differences.length - 1) * 0.975)], 4)
    ]
  };
}
