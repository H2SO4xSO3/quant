import { describe, expect, it } from "vitest";
import {
  buildSignedQuery,
  floorToStep,
  formatDecimal,
  normalizeSymbolRules,
  roundOrderToRules
} from "./filters";

const symbolInfo = {
  symbol: "BTCUSDT",
  filters: [
    { filterType: "PRICE_FILTER", minPrice: "0.01000000", maxPrice: "1000000.00000000", tickSize: "0.01000000" },
    { filterType: "LOT_SIZE", minQty: "0.00001000", maxQty: "9000.00000000", stepSize: "0.00001000" },
    { filterType: "MIN_NOTIONAL", minNotional: "5.00000000", applyToMarket: true, avgPriceMins: 5 }
  ]
};

describe("Binance filter and signing helpers", () => {
  it("builds HMAC signed query strings in Binance parameter order", () => {
    const signed = buildSignedQuery(
      {
        symbol: "LTCBTC",
        side: "BUY",
        type: "LIMIT",
        timeInForce: "GTC",
        quantity: "1",
        price: "0.1",
        recvWindow: "5000",
        timestamp: "1499827319559"
      },
      "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j"
    );

    expect(signed).toBe(
      "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559&signature=c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71"
    );
  });

  it("floors decimal values to Binance step sizes without floating point drift", () => {
    expect(floorToStep(0.00123999, 0.00001)).toBe(0.00123);
    expect(formatDecimal(0.00123, 0.00001)).toBe("0.00123");
    expect(formatDecimal(26123.987654, 0.01)).toBe("26123.98");
  });

  it("rounds orders to symbol rules and rejects orders below min notional", () => {
    const rules = normalizeSymbolRules(symbolInfo);
    const rounded = roundOrderToRules({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 6, lastPrice: 50000 }, rules);

    expect(rounded).toEqual({ symbol: "BTCUSDT", side: "BUY", type: "MARKET", quoteOrderQty: "6" });
    expect(() => roundOrderToRules({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 4.99, lastPrice: 50000 }, rules)).toThrow(
      /min notional/i
    );
    expect(roundOrderToRules({ symbol: "BTCUSDT", side: "SELL", quantity: 0.00123999, lastPrice: 50000 }, rules)).toEqual({
      symbol: "BTCUSDT",
      side: "SELL",
      type: "MARKET",
      quantity: "0.00123"
    });
  });
});
