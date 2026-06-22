import type { BacktestResult } from "./backtest";

export interface StrategyScore {
  overallScore: number;
  grade: "A" | "B" | "C" | "D" | "E";
  components: {
    returnScore: number;
    profitFactorScore: number;
    drawdownScore: number;
    winRateScore: number;
    sampleSizeScore: number;
    capitalUseScore: number;
  };
  summary: {
    strategyId?: string;
    trades: number;
    netPnlUsdt: number;
    returnPct: number;
    profitFactor: number;
    maxDrawdownPct: number;
    winRatePct: number;
  };
}

function boundedScore(value: number, floor: number, ceiling: number): number {
  if (ceiling <= floor) {
    return 50;
  }
  return Math.max(0, Math.min(100, ((value - floor) / (ceiling - floor)) * 100));
}

function inverseScore(value: number, floor: number, ceiling: number): number {
  if (ceiling <= floor) {
    return 50;
  }
  return Math.max(0, Math.min(100, (1 - (value - floor) / (ceiling - floor)) * 100));
}

function grade(score: number): StrategyScore["grade"] {
  if (score >= 85) return "A";
  if (score >= 72) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  return "E";
}

export function scoreBacktestResult(result: BacktestResult): StrategyScore {
  const totals = result.totals;
  const trades = totals.trades;
  const returnScore = boundedScore(totals.returnPct, -5, 8);
  const profitFactorScore = boundedScore(Number.isFinite(totals.profitFactor) ? totals.profitFactor : 3, 0.7, 2.2);
  const drawdownScore = inverseScore(totals.maxDrawdownPct, 0.25, 8);
  const winRateScore = boundedScore(totals.winRate * 100, 20, 65);
  const sampleSizeScore = boundedScore(trades, 5, 80);
  const capitalUseScore = boundedScore(totals.capitalUtilizationPct, 5, 70);

  let overall =
    returnScore * 0.28 +
    profitFactorScore * 0.24 +
    drawdownScore * 0.22 +
    winRateScore * 0.1 +
    sampleSizeScore * 0.08 +
    capitalUseScore * 0.08;

  if (trades < 5) {
    overall -= 12;
  } else if (trades < 12) {
    overall -= 5;
  }
  if (totals.netPnlUsdt <= 0) {
    overall -= 8;
  }
  if (totals.profitFactor < 1) {
    overall -= 6;
  }

  overall = Math.max(0, Math.min(100, overall));

  return {
    overallScore: Number(overall.toFixed(2)),
    grade: grade(overall),
    components: {
      returnScore: Number(returnScore.toFixed(2)),
      profitFactorScore: Number(profitFactorScore.toFixed(2)),
      drawdownScore: Number(drawdownScore.toFixed(2)),
      winRateScore: Number(winRateScore.toFixed(2)),
      sampleSizeScore: Number(sampleSizeScore.toFixed(2)),
      capitalUseScore: Number(capitalUseScore.toFixed(2))
    },
    summary: {
      strategyId: result.strategyId,
      trades,
      netPnlUsdt: totals.netPnlUsdt,
      returnPct: totals.returnPct,
      profitFactor: totals.profitFactor,
      maxDrawdownPct: totals.maxDrawdownPct,
      winRatePct: totals.winRate * 100
    }
  };
}

export function rankBacktestResults<T extends BacktestResult>(results: T[]): Array<T & { score: StrategyScore }> {
  return results
    .map((result) => ({ ...result, score: scoreBacktestResult(result) }))
    .sort((a, b) => b.score.overallScore - a.score.overallScore);
}
