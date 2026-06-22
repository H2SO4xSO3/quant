import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnvFile } from "../crypto/config";

export type PolymarketTimeframe = "5m" | "15m" | "1h";

export interface PolymarketCollectorConfig {
  enabled: boolean;
  symbols: string[];
  timeframes: PolymarketTimeframe[];
  pollIntervalSeconds: number;
  saveOrderbook: boolean;
  saveTrades: boolean;
  dataDir: string;
  gammaBaseUrl: string;
  clobBaseUrl: string;
  dataApiBaseUrl: string;
  discoveryLimit: number;
}

interface ConfigOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

const SUPPORTED_TIMEFRAMES = new Set<PolymarketTimeframe>(["5m", "15m", "1h"]);

export function loadPolymarketCollectorConfig(envFilePath = path.resolve(process.cwd(), ".env"), options: ConfigOptions = {}): PolymarketCollectorConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = mergedEnv(envFilePath, options.env ?? process.env);

  return {
    enabled: asBoolean(env.POLYMARKET_COLLECTOR_ENABLED),
    symbols: list(env.POLYMARKET_SYMBOLS ?? "BTC,ETH,SOL").map((symbol) => symbol.toUpperCase()),
    timeframes: list(env.POLYMARKET_TIMEFRAMES ?? "15m").map(parseTimeframe),
    pollIntervalSeconds: Math.max(5, asNumber(env.POLYMARKET_POLL_INTERVAL_SECONDS, 5)),
    saveOrderbook: env.POLYMARKET_SAVE_ORDERBOOK?.toLowerCase() !== "false",
    saveTrades: env.POLYMARKET_SAVE_TRADES?.toLowerCase() !== "false",
    dataDir: env.POLYMARKET_DATA_DIR ?? path.resolve(cwd, "data/polymarket"),
    gammaBaseUrl: env.POLYMARKET_GAMMA_BASE_URL ?? "https://gamma-api.polymarket.com",
    clobBaseUrl: env.POLYMARKET_CLOB_BASE_URL ?? "https://clob.polymarket.com",
    dataApiBaseUrl: env.POLYMARKET_DATA_API_BASE_URL ?? "https://data-api.polymarket.com",
    discoveryLimit: asNumber(env.POLYMARKET_DISCOVERY_LIMIT, 80)
  };
}

function mergedEnv(envFilePath: string, env: Record<string, string | undefined>) {
  const fileEnv = existsSync(envFilePath) ? parseEnvFile(readFileSync(envFilePath, "utf8")) : {};
  return { ...fileEnv, ...env };
}

function list(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function asBoolean(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

function asNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTimeframe(value: string): PolymarketTimeframe {
  const normalized = value.trim().toLowerCase() as PolymarketTimeframe;
  if (!SUPPORTED_TIMEFRAMES.has(normalized)) {
    throw new Error(`Unsupported Polymarket timeframe ${value}. Use one of: ${Array.from(SUPPORTED_TIMEFRAMES).join(", ")}`);
  }
  return normalized;
}
