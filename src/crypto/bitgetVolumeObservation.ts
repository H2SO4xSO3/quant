import type { BitgetMarketContext } from "./bitgetMarketData";

export interface StoredBitgetMarketContext extends BitgetMarketContext {
  timestampReceived: string;
}

export type BitgetVolumeObservationDirection = "long_watch" | "short_watch";

export interface BitgetVolumeObservationReport {
  symbol: string;
  action: "hold";
  direction: BitgetVolumeObservationDirection;
  rawScore: number;
  longScore: number;
  shortScore: number;
  state: "observe_only";
  blocked: string;
  evidence: {
    samples: number;
    hours: number;
    first: string;
    last: string;
    openInterest24hPct: number;
    openInterest12hPct: number;
    latestTakerImbalancePct: number;
    takerWindowImbalancePct: number;
    longShortRatio: number | null;
    accountLongShortRatio: number | null;
    positionLongShortRatio: number | null;
    latestFundingRatePct: number;
  };
  nextCheck: string;
}

export interface BitgetVolumeObservationOptions {
  contexts: StoredBitgetMarketContext[];
  minHours?: number;
  minRawScore?: number;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function compact(value: number, decimals: number): string {
  return round(value, decimals).toString();
}

function pct(current: number, previous: number): number {
  return previous === 0 ? 0 : ((current - previous) / previous) * 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function newest<T extends { timestampMs: number }>(rows: T[] | undefined): T | undefined {
  if (!rows || rows.length === 0) {
    return undefined;
  }
  return [...rows].sort((a, b) => b.timestampMs - a.timestampMs)[0];
}

function previousAtOrBefore(rows: StoredBitgetMarketContext[], timestampMs: number): StoredBitgetMarketContext {
  return [...rows].reverse().find((row) => Date.parse(row.timestampReceived) <= timestampMs) ?? rows[0];
}

function sumTakerWindow(rows: StoredBitgetMarketContext[]): { buyVolume: number; sellVolume: number } {
  const latest = rows.at(-1);
  const window = latest?.takerBuySell.slice(0, 30) ?? [];
  return window.reduce(
    (total, row) => ({
      buyVolume: total.buyVolume + row.buyVolume,
      sellVolume: total.sellVolume + row.sellVolume
    }),
    { buyVolume: 0, sellVolume: 0 }
  );
}

function imbalance(buyVolume: number, sellVolume: number): number {
  const total = buyVolume + sellVolume;
  return total === 0 ? 0 : (buyVolume - sellVolume) / total;
}

function groupBySymbol(contexts: StoredBitgetMarketContext[]): Map<string, StoredBitgetMarketContext[]> {
  const grouped = new Map<string, StoredBitgetMarketContext[]>();
  for (const context of contexts) {
    const symbol = context.symbol.toUpperCase();
    grouped.set(symbol, [...(grouped.get(symbol) ?? []), context]);
  }
  for (const rows of grouped.values()) {
    rows.sort((a, b) => Date.parse(a.timestampReceived) - Date.parse(b.timestampReceived));
  }
  return grouped;
}

export function buildBitgetVolumeObservationReports(options: BitgetVolumeObservationOptions): BitgetVolumeObservationReport[] {
  const minHours = options.minHours ?? 168;
  const minRawScore = options.minRawScore ?? 70;
  const reports: BitgetVolumeObservationReport[] = [];

  for (const [symbol, rows] of groupBySymbol(options.contexts)) {
    const first = rows[0];
    const last = rows.at(-1);
    if (!first || !last) {
      continue;
    }

    const lastMs = Date.parse(last.timestampReceived);
    const hours = (lastMs - Date.parse(first.timestampReceived)) / 36e5;
    const prior24 = previousAtOrBefore(rows, lastMs - 24 * 60 * 60 * 1000);
    const prior12 = previousAtOrBefore(rows, lastMs - 12 * 60 * 60 * 1000);
    const oiNow = last.openInterest?.openInterest ?? 0;
    const openInterest24hPct = pct(oiNow, prior24.openInterest?.openInterest ?? 0);
    const openInterest12hPct = pct(oiNow, prior12.openInterest?.openInterest ?? 0);
    const latestTaker = newest(last.takerBuySell);
    const latestTakerImbalance = imbalance(latestTaker?.buyVolume ?? 0, latestTaker?.sellVolume ?? 0);
    const takerWindow = sumTakerWindow(rows);
    const takerWindowImbalance = imbalance(takerWindow.buyVolume, takerWindow.sellVolume);
    const longShort = newest(last.longShort);
    const accountLongShort = newest(last.accountLongShort);
    const positionLongShort = newest(last.positionLongShort);
    const latestFundingRate = newest(last.fundingRates)?.fundingRate ?? 0;
    const crowdLongRatio = positionLongShort?.longShortPositionRatio ?? accountLongShort?.longShortAccountRatio ?? longShort?.longShortRatio ?? 1;

    let longScore = 50;
    longScore += clamp(takerWindowImbalance * 140, -18, 18);
    longScore += clamp(openInterest24hPct * 1.2, -10, 10);
    longScore += latestFundingRate < 0 ? 4 : latestFundingRate > 0.00008 ? -5 : -1;
    longScore += crowdLongRatio < 0.85 ? 4 : crowdLongRatio > 1.25 ? -5 : 0;

    let shortScore = 50;
    shortScore += clamp(-takerWindowImbalance * 140, -18, 18);
    shortScore += clamp(openInterest24hPct, -8, 8);
    shortScore += latestFundingRate > 0.00008 ? 5 : latestFundingRate < -0.00002 ? -4 : 1;
    shortScore += crowdLongRatio > 1.25 ? 4 : crowdLongRatio < 0.85 ? -5 : 0;

    const rawScore = Math.max(longScore, shortScore);
    const blockers: string[] = [];
    if (hours < minHours) {
      blockers.push(`insufficient_volume_history ${compact(hours, 1)}h<${compact(minHours, 1)}h`);
    }
    if (rawScore < minRawScore) {
      blockers.push(`weak_edge rawScore=${compact(rawScore, 1)}<${compact(minRawScore, 1)}`);
    }
    blockers.push("observe_only no execution gate connected");

    reports.push({
      symbol,
      action: "hold",
      direction: longScore >= shortScore ? "long_watch" : "short_watch",
      rawScore: round(rawScore, 1),
      longScore: round(longScore, 1),
      shortScore: round(shortScore, 1),
      state: "observe_only",
      blocked: blockers.join("; "),
      evidence: {
        samples: rows.length,
        hours: round(hours, 2),
        first: first.timestampReceived,
        last: last.timestampReceived,
        openInterest24hPct: round(openInterest24hPct, 2),
        openInterest12hPct: round(openInterest12hPct, 2),
        latestTakerImbalancePct: round(latestTakerImbalance * 100, 2),
        takerWindowImbalancePct: round(takerWindowImbalance * 100, 2),
        longShortRatio: longShort ? round(longShort.longShortRatio, 3) : null,
        accountLongShortRatio: accountLongShort ? round(accountLongShort.longShortAccountRatio, 3) : null,
        positionLongShortRatio: positionLongShort ? round(positionLongShort.longShortPositionRatio, 3) : null,
        latestFundingRatePct: round(latestFundingRate * 100, 4)
      },
      nextCheck:
        hours < minHours
          ? "rerun after 7d coverage; then connect score as blocker/feature, not execution trigger"
          : "validate score against forward returns; keep score as blocker/feature, not execution trigger"
    });
  }

  return reports;
}
