import { createHmac } from "node:crypto";
import type { BinanceSymbolInfo, NormalizedOrder, SymbolRules } from "./types";

type QueryValue = string | number | boolean | undefined;

function decimalPlaces(value: number | string): number {
  const text = String(value);
  if (text.includes("e-")) {
    return Number(text.split("e-")[1]);
  }
  const decimal = text.split(".")[1] ?? "";
  return decimal.replace(/0+$/, "").length;
}

function findFilter(symbolInfo: BinanceSymbolInfo, filterType: string) {
  return symbolInfo.filters.find((filter) => filter.filterType === filterType);
}

export function buildQuery(params: Record<string, QueryValue>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

export function buildSignedQuery(params: Record<string, QueryValue>, secretKey: string): string {
  const query = buildQuery(params);
  const signature = createHmac("sha256", secretKey).update(query).digest("hex");
  return `${query}&signature=${signature}`;
}

export function floorToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return 0;
  }
  const places = decimalPlaces(step);
  const scale = 10 ** places;
  const floored = Math.floor((value + Number.EPSILON) * scale) / scale;
  return Number(floored.toFixed(places));
}

export function formatDecimal(value: number, step: number): string {
  const places = decimalPlaces(step);
  return floorToStep(value, step).toFixed(places).replace(/\.?0+$/, "");
}

export function normalizeSymbolRules(symbolInfo: BinanceSymbolInfo): SymbolRules {
  const priceFilter = findFilter(symbolInfo, "PRICE_FILTER");
  const lotSize = findFilter(symbolInfo, "LOT_SIZE");
  const minNotional = findFilter(symbolInfo, "MIN_NOTIONAL") ?? findFilter(symbolInfo, "NOTIONAL");

  return {
    symbol: symbolInfo.symbol,
    tickSize: Number(priceFilter?.tickSize ?? 0.00000001),
    stepSize: Number(lotSize?.stepSize ?? 0.00000001),
    minQty: Number(lotSize?.minQty ?? 0),
    maxQty: Number(lotSize?.maxQty ?? Number.MAX_SAFE_INTEGER),
    minNotional: Number(minNotional?.minNotional ?? minNotional?.notional ?? 0)
  };
}

export function roundOrderToRules(
  order: { symbol: string; side: "BUY" | "SELL"; quoteOrderQty?: number; quantity?: number; lastPrice: number },
  rules: SymbolRules
): NormalizedOrder {
  if (order.symbol !== rules.symbol) {
    throw new Error(`Symbol rules mismatch: ${order.symbol} vs ${rules.symbol}`);
  }

  if (order.side === "BUY") {
    const quoteOrderQty = Number(order.quoteOrderQty ?? 0);
    if (quoteOrderQty < rules.minNotional) {
      throw new Error(`Order quote amount is below Binance min notional ${rules.minNotional}`);
    }
    return { symbol: order.symbol, side: order.side, type: "MARKET", quoteOrderQty: formatDecimal(quoteOrderQty, 0.00000001) };
  }

  const quantity = floorToStep(Number(order.quantity ?? 0), rules.stepSize);
  if (quantity < rules.minQty || quantity > rules.maxQty) {
    throw new Error(`Order quantity violates Binance lot size for ${order.symbol}`);
  }
  if (quantity * order.lastPrice < rules.minNotional) {
    throw new Error(`Order notional is below Binance min notional ${rules.minNotional}`);
  }

  return { symbol: order.symbol, side: order.side, type: "MARKET", quantity: formatDecimal(quantity, rules.stepSize) };
}
