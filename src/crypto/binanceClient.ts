import { buildQuery, buildSignedQuery, normalizeSymbolRules } from "./filters";
import type { BinanceAggTrade, BinanceDepth, BinanceKline, BinanceSymbolInfo, NormalizedOrder, SymbolRules } from "./types";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BinanceClientOptions {
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface CryptoMarketBundle {
  klines: BinanceKline[];
  higherKlines?: BinanceKline[];
  hourlyKlines?: BinanceKline[];
  depth: BinanceDepth;
  trades: BinanceAggTrade[];
}

export class BinanceClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BinanceClientOptions = {}) {
    this.apiKey = options.apiKey ?? "";
    this.apiSecret = options.apiSecret ?? "";
    this.baseUrl = options.baseUrl ?? "https://api.binance.com";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(
    method: "GET" | "POST",
    pathName: string,
    params: Record<string, string | number | boolean | undefined> = {},
    signed = false
  ): Promise<T> {
    const nextParams = signed ? { ...params, recvWindow: 5000, timestamp: Date.now() } : params;
    const query = signed ? buildSignedQuery(nextParams, this.apiSecret) : buildQuery(nextParams);
    const url = `${this.baseUrl}${pathName}${query ? `?${query}` : ""}`;
    const maxAttempts = method === "GET" ? 3 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: this.apiKey ? { "X-MBX-APIKEY": this.apiKey } : undefined
        });
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts || method !== "GET") {
          throw error;
        }
        await sleep(500 * attempt);
        continue;
      }

      if (response.ok) {
        return (await response.json()) as T;
      }

      const body = await response.text();
      lastError = new Error(`Binance ${pathName} failed: ${response.status} ${body}`);
      if (!RETRYABLE_STATUS.has(response.status) || attempt === maxAttempts) {
        throw lastError;
      }

      await sleep(500 * attempt);
    }

    throw lastError instanceof Error ? lastError : new Error(`Binance ${pathName} request failed`);
  }

  async fetchMarket(symbol: string): Promise<CryptoMarketBundle> {
    const [klines, higherKlines, hourlyKlines, depth, trades] = await Promise.all([
      this.request<BinanceKline[]>("GET", "/api/v3/klines", { symbol, interval: "5m", limit: 240 }),
      this.request<BinanceKline[]>("GET", "/api/v3/klines", { symbol, interval: "15m", limit: 200 }),
      this.request<BinanceKline[]>("GET", "/api/v3/klines", { symbol, interval: "1h", limit: 120 }),
      this.request<BinanceDepth>("GET", "/api/v3/depth", { symbol, limit: 100 }),
      this.request<BinanceAggTrade[]>("GET", "/api/v3/aggTrades", { symbol, limit: 500 })
    ]);
    return { klines, higherKlines, hourlyKlines, depth, trades };
  }

  async fetchKlines(symbol: string, interval: string, startTime?: number, endTime?: number, limit = 1000): Promise<BinanceKline[]> {
    return this.request<BinanceKline[]>("GET", "/api/v3/klines", { symbol, interval, startTime, endTime, limit });
  }

  async fetchTickerPrice(symbol: string): Promise<number> {
    const payload = await this.request<{ symbol: string; price: string }>("GET", "/api/v3/ticker/price", { symbol });
    return Number(payload.price);
  }

  async getRules(symbol: string): Promise<SymbolRules> {
    const payload = await this.request<{ symbols: BinanceSymbolInfo[] }>("GET", "/api/v3/exchangeInfo", { symbol });
    const info = payload.symbols.find((item) => item.symbol === symbol);
    if (!info) {
      throw new Error(`Binance exchangeInfo missing symbol ${symbol}`);
    }
    return normalizeSymbolRules(info);
  }

  async testMarketOrder(order: NormalizedOrder): Promise<unknown> {
    this.ensureCredentials();
    return this.request("POST", "/api/v3/order/test", { ...order }, true);
  }

  async placeMarketOrder(order: NormalizedOrder): Promise<unknown> {
    this.ensureCredentials();
    return this.request("POST", "/api/v3/order", { ...order }, true);
  }

  private ensureCredentials(): void {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error("Binance API key/secret is not configured in local .env");
    }
  }
}
