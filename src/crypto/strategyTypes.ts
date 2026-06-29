import type { CryptoMarketAnalysis, CryptoSignal, CryptoStrategyConfig } from "./types";

export type StrategyReadiness =
  | "research_only"
  | "backtest_candidate"
  | "paper_ready"
  | "observe_only"
  | "sim_ready"
  | "live_candidate"
  | "live_ready"
  | "no_trade";

export interface StrategySignalInput {
  analysis: CryptoMarketAnalysis;
  orderQuoteQty: number;
  config: CryptoStrategyConfig;
}

export interface CryptoStrategy {
  id: string;
  label: string;
  readiness?: StrategyReadiness;
  blockedReason?: string;
  generateSignal(input: StrategySignalInput): CryptoSignal;
}
