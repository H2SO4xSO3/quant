import { describe, expect, it } from "vitest";
import { DEFAULT_RESEARCH_VALIDATION_CRITERIA, buildResearchValidationReport } from "./researchValidation";
import type { ResearchScenarioSummary } from "./research";

function summary(name: string, overrides: Partial<ResearchScenarioSummary>): ResearchScenarioSummary {
  return {
    name,
    trades: 20,
    netPnlPct: 2,
    avgPnlPct: 0.1,
    grossMovePct: 4,
    avgGrossMovePct: 0.2,
    winRate: 0.55,
    profitFactor: 1.4,
    maxDrawdownPct: 1,
    avgMfePct: 0.8,
    avgMaePct: -0.4,
    reasonCounts: { take_profit: 8, stop_loss: 5, timeout: 7 },
    score: 10,
    ...overrides
  };
}

describe("research validation", () => {
  it("keeps only scenarios that were selected in-sample and stayed profitable out-of-sample", () => {
    const report = buildResearchValidationReport({
      splitTime: 1000,
      splitTimeIso: "1970-01-01T00:00:01.000Z",
      criteria: DEFAULT_RESEARCH_VALIDATION_CRITERIA,
      scenarios: [
        {
          ...summary("stable", { netPnlPct: 5 }),
          inSample: summary("stable", { trades: 14, netPnlPct: 2, profitFactor: 1.3 }),
          outOfSample: summary("stable", { trades: 16, netPnlPct: 3, profitFactor: 1.5 })
        },
        {
          ...summary("overfit", { netPnlPct: 1 }),
          inSample: summary("overfit", { trades: 16, netPnlPct: 4, profitFactor: 2.1 }),
          outOfSample: summary("overfit", { trades: 18, netPnlPct: -3, profitFactor: 0.4 })
        },
        {
          ...summary("too-small", { netPnlPct: 6 }),
          inSample: summary("too-small", { trades: 4, netPnlPct: 3, profitFactor: 2.2 }),
          outOfSample: summary("too-small", { trades: 20, netPnlPct: 3, profitFactor: 1.6 })
        }
      ]
    });

    expect(report.selected.length).toBe(2);
    expect(report.survivors.map((item) => item.name)).toEqual(["stable"]);
    expect(report.rejected.find((item) => item.name === "overfit")?.reasons).toContain("out_sample_net_pnl_below_min");
    expect(report.rejected.find((item) => item.name === "too-small")?.reasons).toContain("in_sample_trades_below_min");
  });
});
