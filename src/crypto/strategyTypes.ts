import type { CryptoMarketAnalysis, CryptoSignal, CryptoStrategyConfig } from "./types";

export interface StrategySignalInput {
  analysis: CryptoMarketAnalysis;
  orderQuoteQty: number;
  config: CryptoStrategyConfig;
}

export interface CryptoStrategy {
  id: string;
  label: string;
  generateSignal(input: StrategySignalInput): CryptoSignal;
}
