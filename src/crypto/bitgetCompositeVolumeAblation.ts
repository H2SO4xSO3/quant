import type { FuturesSignalObservation } from "./futuresBacktest";
import {
  labelSignalEvents,
  summarizeLabeledEvents,
  type LabeledEventSummary,
  type ResearchPriceBar,
  type VolumeWatchDirection
} from "./bitgetVolumeSignalResearch";

export type CompositeVolumeVariant = "router_baseline" | "volume_score_filter" | "crowding_flow_veto";
export type RouterCandidateBranch = "trend" | "reversion" | "unknown";

export interface RouterCandidate {
  id: string;
  symbol: string;
  timestampMs: number;
  direction: VolumeWatchDirection;
  branch: RouterCandidateBranch;
  strategyRawScore: number;
  reasons: string[];
}

export interface VolumeContextSnapshot {
  symbol: string;
  timestampMs: number;
  rawScore: number;
  direction: VolumeWatchDirection;
  openInterest24hPct: number;
  openInterest12hPct: number;
  takerWindowImbalancePct: number;
  longShortRatio: number | null;
  accountLongShortRatio: number | null;
  positionLongShortRatio: number | null;
  latestFundingRatePct: number;
}

export interface VariantDecision {
  accepted: boolean;
  blocked: string | null;
}

export interface CompositeVolumeLedgerRow extends RouterCandidate {
  volume: VolumeContextSnapshot | null;
  volumeContextAgeMinutes: number | null;
  decisions: Record<CompositeVolumeVariant, VariantDecision>;
}

export interface CandidateOutcome {
  candidateId: string;
  symbol: string;
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

export interface PairedVariantComparison {
  completed: number;
  meanDeltaPct: number | null;
  meanDeltaCi95Pct: [number, number] | null;
}

export interface CompositeVolumeVariantSummary {
  variant: CompositeVolumeVariant;
  horizonMinutes: number;
  roundTripCostPct: number;
  totalCandidates: number;
  acceptedCandidates: number;
  blockedCandidates: number;
  summary: LabeledEventSummary;
  paired: PairedVariantComparison;
}

export interface CompositeVolumeAblationGrade {
  action: "hold";
  rawScore: number;
  state: "no_trade" | "observe_only";
  blocked: "sample_too_small" | "weak_paired_edge" | "paper_evidence_missing";
  evidence: string;
  nextCheck: string;
}

const VARIANTS: CompositeVolumeVariant[] = ["router_baseline", "volume_score_filter", "crowding_flow_veto"];

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function bootstrapMeanCi(values: number[], iterations = 5_000): [number, number] | null {
  if (values.length < 2) {
    return null;
  }
  let seed = 20_260_719;
  const samples: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      seed = (1_664_525 * seed + 1_013_904_223) >>> 0;
      sum += values[Math.floor((seed / 2 ** 32) * values.length)];
    }
    samples.push(sum / values.length);
  }
  samples.sort((left, right) => left - right);
  return [round(samples[Math.floor((samples.length - 1) * 0.025)]), round(samples[Math.floor((samples.length - 1) * 0.975)])];
}

function selectedBranch(reasons: string[]): RouterCandidateBranch {
  const selected = reasons.map((reason) => reason.match(/Bitget composite selected (trend|reversion) branch/i)).find(Boolean);
  return selected?.[1]?.toLowerCase() === "trend" ? "trend" : selected?.[1]?.toLowerCase() === "reversion" ? "reversion" : "unknown";
}

function isExitOnly(observation: FuturesSignalObservation): boolean {
  return observation.signal.reasons.some((reason) => reason.startsWith("Exit invalidation:"));
}

export function extractRouterCandidates(observations: FuturesSignalObservation[], cooldownMinutes = 1_440): RouterCandidate[] {
  const lastAcceptedBySymbol = new Map<string, number>();
  const candidates: RouterCandidate[] = [];

  for (const observation of [...observations].sort((left, right) => left.openTime - right.openTime || left.symbol.localeCompare(right.symbol))) {
    if ((observation.signal.action !== "buy" && observation.signal.action !== "sell") || isExitOnly(observation)) {
      continue;
    }
    const symbol = observation.symbol.toUpperCase();
    const lastAccepted = lastAcceptedBySymbol.get(symbol) ?? Number.NEGATIVE_INFINITY;
    if (observation.openTime - lastAccepted < cooldownMinutes * 60_000) {
      continue;
    }
    const direction: VolumeWatchDirection = observation.signal.action === "buy" ? "long_watch" : "short_watch";
    candidates.push({
      id: `${symbol}:${observation.openTime}:${direction}`,
      symbol,
      timestampMs: observation.openTime,
      direction,
      branch: selectedBranch(observation.signal.reasons),
      strategyRawScore: observation.signal.score,
      reasons: observation.signal.reasons
    });
    lastAcceptedBySymbol.set(symbol, observation.openTime);
  }

  return candidates;
}

function crowdLongRatio(volume: VolumeContextSnapshot): number | null {
  return volume.positionLongShortRatio ?? volume.accountLongShortRatio ?? volume.longShortRatio;
}

function volumeUnavailableDecision(reason: string): Record<Exclude<CompositeVolumeVariant, "router_baseline">, VariantDecision> {
  return {
    volume_score_filter: { accepted: false, blocked: reason },
    crowding_flow_veto: { accepted: false, blocked: reason }
  };
}

function scoreDecision(candidate: RouterCandidate, volume: VolumeContextSnapshot): VariantDecision {
  if (volume.rawScore < 70) {
    return { accepted: false, blocked: `weak_volume_score rawScore=${volume.rawScore.toFixed(1)}<70` };
  }
  if (candidate.direction !== volume.direction) {
    return { accepted: false, blocked: "volume_direction_conflict" };
  }
  return { accepted: true, blocked: null };
}

function vetoDecision(candidate: RouterCandidate, volume: VolumeContextSnapshot): VariantDecision {
  const ratio = crowdLongRatio(volume);
  if (candidate.direction === "long_watch") {
    if (volume.takerWindowImbalancePct <= -10) {
      return { accepted: false, blocked: "adverse_taker_flow" };
    }
    if (ratio !== null && ratio >= 1.25 && volume.latestFundingRatePct > 0.008) {
      return { accepted: false, blocked: "crowded_long_funding_risk" };
    }
  } else {
    if (volume.takerWindowImbalancePct >= 10) {
      return { accepted: false, blocked: "adverse_taker_flow" };
    }
    if (ratio !== null && ratio <= 0.85 && volume.latestFundingRatePct < -0.002) {
      return { accepted: false, blocked: "crowded_short_funding_risk" };
    }
  }
  return { accepted: true, blocked: null };
}

export function buildCandidateLedger(options: {
  candidates: RouterCandidate[];
  volumeSnapshots: VolumeContextSnapshot[];
  maxContextAgeMinutes?: number;
}): CompositeVolumeLedgerRow[] {
  const maxAgeMinutes = options.maxContextAgeMinutes ?? 15;
  const bySymbol = new Map<string, VolumeContextSnapshot[]>();
  for (const snapshot of options.volumeSnapshots) {
    const symbol = snapshot.symbol.toUpperCase();
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), { ...snapshot, symbol }]);
  }
  for (const snapshots of bySymbol.values()) {
    snapshots.sort((left, right) => left.timestampMs - right.timestampMs);
  }

  return options.candidates.map((candidate) => {
    const snapshots = bySymbol.get(candidate.symbol) ?? [];
    const volume = [...snapshots].reverse().find((snapshot) => snapshot.timestampMs <= candidate.timestampMs) ?? null;
    const ageMinutes = volume ? (candidate.timestampMs - volume.timestampMs) / 60_000 : null;
    let filtered: Record<Exclude<CompositeVolumeVariant, "router_baseline">, VariantDecision>;
    if (!volume) {
      filtered = volumeUnavailableDecision("volume_context_missing");
    } else if (ageMinutes !== null && ageMinutes > maxAgeMinutes) {
      filtered = volumeUnavailableDecision("volume_context_stale");
    } else {
      filtered = {
        volume_score_filter: scoreDecision(candidate, volume),
        crowding_flow_veto: vetoDecision(candidate, volume)
      };
    }
    return {
      ...candidate,
      volume,
      volumeContextAgeMinutes: ageMinutes === null ? null : round(ageMinutes, 2),
      decisions: {
        router_baseline: { accepted: true, blocked: null },
        ...filtered
      }
    };
  });
}

export function labelCandidateOutcomes(options: {
  ledger: CompositeVolumeLedgerRow[];
  bars: ResearchPriceBar[];
  horizonsMinutes: number[];
  roundTripCostsPct: number[];
}): CandidateOutcome[] {
  const outcomes: CandidateOutcome[] = [];
  for (const horizonMinutes of options.horizonsMinutes) {
    for (const roundTripCostPct of options.roundTripCostsPct) {
      for (const row of options.ledger) {
        const [label] = labelSignalEvents({
          events: [{ symbol: row.symbol, timestampMs: row.timestampMs, direction: row.direction, rawScore: row.strategyRawScore, threshold: 0 }],
          bars: options.bars,
          horizonMinutes,
          roundTripCostPct
        });
        outcomes.push({
          candidateId: row.id,
          symbol: row.symbol,
          horizonMinutes,
          roundTripCostPct,
          status: label.status,
          pendingReason: label.pendingReason,
          entryTimeMs: label.entryTimeMs,
          exitTimeMs: label.exitTimeMs,
          entryPrice: label.entryPrice,
          exitPrice: label.exitPrice,
          grossDirectionalReturnPct: label.grossDirectionalReturnPct,
          netDirectionalReturnPct: label.netDirectionalReturnPct,
          mfePct: label.mfePct,
          maePct: label.maePct
        });
      }
    }
  }
  return outcomes;
}

function asLabeledSummary(outcomes: CandidateOutcome[], ledgerById: Map<string, CompositeVolumeLedgerRow>): LabeledEventSummary {
  return summarizeLabeledEvents(
    outcomes.map((outcome) => {
      const candidate = ledgerById.get(outcome.candidateId)!;
      return {
        ...outcome,
        symbol: outcome.symbol,
        timestampMs: candidate.timestampMs,
        direction: candidate.direction,
        rawScore: candidate.strategyRawScore,
        threshold: 0
      };
    })
  );
}

export function buildVariantSummaries(options: {
  ledger: CompositeVolumeLedgerRow[];
  outcomes: CandidateOutcome[];
  horizonsMinutes: number[];
  roundTripCostsPct: number[];
}): CompositeVolumeVariantSummary[] {
  const ledgerById = new Map(options.ledger.map((row) => [row.id, row]));
  const summaries: CompositeVolumeVariantSummary[] = [];

  for (const horizonMinutes of options.horizonsMinutes) {
    for (const roundTripCostPct of options.roundTripCostsPct) {
      const cellOutcomes = options.outcomes.filter(
        (outcome) => outcome.horizonMinutes === horizonMinutes && outcome.roundTripCostPct === roundTripCostPct
      );
      for (const variant of VARIANTS) {
        const acceptedIds = new Set(options.ledger.filter((row) => row.decisions[variant].accepted).map((row) => row.id));
        const acceptedOutcomes = cellOutcomes.filter((outcome) => acceptedIds.has(outcome.candidateId));
        const pairedDeltas = cellOutcomes
          .filter((outcome) => outcome.status === "completed" && outcome.netDirectionalReturnPct !== undefined)
          .map((outcome) => (acceptedIds.has(outcome.candidateId) ? outcome.netDirectionalReturnPct! : 0) - outcome.netDirectionalReturnPct!);
        summaries.push({
          variant,
          horizonMinutes,
          roundTripCostPct,
          totalCandidates: options.ledger.length,
          acceptedCandidates: acceptedIds.size,
          blockedCandidates: options.ledger.length - acceptedIds.size,
          summary: asLabeledSummary(acceptedOutcomes, ledgerById),
          paired: {
            completed: pairedDeltas.length,
            meanDeltaPct: pairedDeltas.length ? round(mean(pairedDeltas)) : null,
            meanDeltaCi95Pct: bootstrapMeanCi(pairedDeltas)
          }
        });
      }
    }
  }
  return summaries;
}

export function gradeCompositeVolumeAblation(options: {
  latestRawScore: number;
  summaries: CompositeVolumeVariantSummary[];
}): CompositeVolumeAblationGrade {
  const filtered = options.summaries.filter((summary) => summary.variant !== "router_baseline");
  const completedMax = Math.max(0, ...filtered.map((summary) => summary.paired.completed));
  if (completedMax < 30) {
    return {
      action: "hold",
      rawScore: options.latestRawScore,
      state: "no_trade",
      blocked: "sample_too_small",
      evidence: `paired_completed_max=${completedMax} required=30`,
      nextCheck: "continue forward candidate collection and rerun paired ablation"
    };
  }

  const robustVariants = (["volume_score_filter", "crowding_flow_veto"] as const).filter((variant) => {
    const horizons = new Set(
      filtered
        .filter((summary) => summary.variant === variant)
        .map((summary) => summary.horizonMinutes)
        .filter((horizonMinutes) =>
          [0.2, 0.3].every((cost) => {
            const cell = filtered.find(
              (summary) => summary.variant === variant && summary.horizonMinutes === horizonMinutes && summary.roundTripCostPct === cost
            );
            return Boolean(
              cell &&
                cell.paired.completed >= 30 &&
                (cell.summary.meanNetReturnPct ?? 0) > 0 &&
                cell.paired.meanDeltaCi95Pct &&
                cell.paired.meanDeltaCi95Pct[0] > 0
            );
          })
        )
    );
    return horizons.size >= 3;
  });

  if (robustVariants.length > 0) {
    return {
      action: "hold",
      rawScore: options.latestRawScore,
      state: "observe_only",
      blocked: "paper_evidence_missing",
      evidence: `robust_variants=${robustVariants.join(",")}`,
      nextCheck: "collect forward paper outcomes before any sim_ready decision"
    };
  }

  return {
    action: "hold",
    rawScore: options.latestRawScore,
    state: "no_trade",
    blocked: "weak_paired_edge",
    evidence: "no filtered variant passed paired confidence and cost gates on three horizons",
    nextCheck: "inspect blocker distribution and paired deltas without retuning on this sample"
  };
}
