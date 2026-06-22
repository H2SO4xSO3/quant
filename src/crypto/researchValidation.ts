import type { ResearchScenarioSummary } from "./research";

export interface ResearchScenarioSplitSummary extends ResearchScenarioSummary {
  inSample: ResearchScenarioSummary;
  outOfSample: ResearchScenarioSummary;
}

export interface ResearchValidationCriteria {
  minInSampleTrades: number;
  minOutOfSampleTrades: number;
  minInSampleNetPnlPct: number;
  minOutOfSampleNetPnlPct: number;
  minInSampleProfitFactor: number;
  minOutOfSampleProfitFactor: number;
}

export interface ResearchValidationInput {
  splitTime: number;
  splitTimeIso: string;
  criteria: ResearchValidationCriteria;
  scenarios: ResearchScenarioSplitSummary[];
}

export interface ResearchValidationItem {
  name: string;
  selectedInSample: boolean;
  passedOutOfSample: boolean;
  stabilityScore: number;
  reasons: string[];
  full: ResearchScenarioSummary;
  inSample: ResearchScenarioSummary;
  outOfSample: ResearchScenarioSummary;
}

export interface ResearchValidationReport {
  enabled: boolean;
  splitTime: number;
  splitTimeIso: string;
  criteria: ResearchValidationCriteria;
  selected: ResearchValidationItem[];
  survivors: ResearchValidationItem[];
  rejected: ResearchValidationItem[];
}

export const DEFAULT_RESEARCH_VALIDATION_CRITERIA: ResearchValidationCriteria = {
  minInSampleTrades: 10,
  minOutOfSampleTrades: 10,
  minInSampleNetPnlPct: 0,
  minOutOfSampleNetPnlPct: 0,
  minInSampleProfitFactor: 1,
  minOutOfSampleProfitFactor: 1
};

export function buildResearchValidationReport(input: ResearchValidationInput): ResearchValidationReport {
  const items = input.scenarios.map((scenario) => validateScenario(scenario, input.criteria));
  const selected = items.filter((item) => item.selectedInSample).sort((a, b) => b.stabilityScore - a.stabilityScore);
  const survivors = selected.filter((item) => item.passedOutOfSample).sort((a, b) => b.stabilityScore - a.stabilityScore);
  const rejected = items.filter((item) => !item.selectedInSample || !item.passedOutOfSample).sort((a, b) => b.stabilityScore - a.stabilityScore);

  return {
    enabled: true,
    splitTime: input.splitTime,
    splitTimeIso: input.splitTimeIso,
    criteria: input.criteria,
    selected,
    survivors,
    rejected
  };
}

function validateScenario(scenario: ResearchScenarioSplitSummary, criteria: ResearchValidationCriteria): ResearchValidationItem {
  const reasons: string[] = [];
  const selectedInSample = meetsInSampleCriteria(scenario.inSample, criteria, reasons);
  const passedOutOfSample = selectedInSample && meetsOutOfSampleCriteria(scenario.outOfSample, criteria, reasons);

  return {
    name: scenario.name,
    selectedInSample,
    passedOutOfSample,
    stabilityScore: scoreValidation(scenario.inSample, scenario.outOfSample),
    reasons,
    full: stripSplitFields(scenario),
    inSample: scenario.inSample,
    outOfSample: scenario.outOfSample
  };
}

function meetsInSampleCriteria(summary: ResearchScenarioSummary, criteria: ResearchValidationCriteria, reasons: string[]): boolean {
  let ok = true;
  if (summary.trades < criteria.minInSampleTrades) {
    reasons.push("in_sample_trades_below_min");
    ok = false;
  }
  if (summary.netPnlPct <= criteria.minInSampleNetPnlPct) {
    reasons.push("in_sample_net_pnl_below_min");
    ok = false;
  }
  if (summary.profitFactor < criteria.minInSampleProfitFactor) {
    reasons.push("in_sample_profit_factor_below_min");
    ok = false;
  }
  return ok;
}

function meetsOutOfSampleCriteria(summary: ResearchScenarioSummary, criteria: ResearchValidationCriteria, reasons: string[]): boolean {
  let ok = true;
  if (summary.trades < criteria.minOutOfSampleTrades) {
    reasons.push("out_sample_trades_below_min");
    ok = false;
  }
  if (summary.netPnlPct <= criteria.minOutOfSampleNetPnlPct) {
    reasons.push("out_sample_net_pnl_below_min");
    ok = false;
  }
  if (summary.profitFactor < criteria.minOutOfSampleProfitFactor) {
    reasons.push("out_sample_profit_factor_below_min");
    ok = false;
  }
  return ok;
}

function scoreValidation(inSample: ResearchScenarioSummary, outOfSample: ResearchScenarioSummary): number {
  const tradeBalance =
    Math.min(inSample.trades, outOfSample.trades) / Math.max(Math.max(inSample.trades, outOfSample.trades), 1);
  return (
    outOfSample.netPnlPct +
    Math.min(outOfSample.profitFactor, 3) * 4 +
    outOfSample.winRate * 5 +
    tradeBalance * 2 -
    outOfSample.maxDrawdownPct * 0.35
  );
}

function stripSplitFields(scenario: ResearchScenarioSplitSummary): ResearchScenarioSummary {
  const { inSample: _inSample, outOfSample: _outOfSample, ...summary } = scenario;
  return summary;
}
