import type { CryptoSignal } from "../types";
import type { CryptoStrategy } from "../strategyTypes";
import { factorLabelAltReboundStrategy } from "./factorLabelAltRebound";
import { factorLabelBnbBreakoutStrategy } from "./factorLabelBnbBreakout";

const DEFAULT_ORDER_USDT = 10;
const BREAKOUT_SYMBOLS = new Set(["BNBUSDT", "BTCUSDT"]);
const REBOUND_SYMBOLS = new Set(["SOLUSDT", "XRPUSDT"]);

export const factorLabelCompositeStrategy: CryptoStrategy = {
  id: "factor-label-composite",
  label: "Factor-label composite rebound plus long breakout",
  generateSignal: (input) => {
    if (BREAKOUT_SYMBOLS.has(input.analysis.symbol)) {
      return factorLabelBnbBreakoutStrategy.generateSignal(input);
    }
    if (REBOUND_SYMBOLS.has(input.analysis.symbol)) {
      return factorLabelAltReboundStrategy.generateSignal(input);
    }

    return hold(input.analysis.symbol, input.analysis.price, input.orderQuoteQty ?? DEFAULT_ORDER_USDT);
  }
};

function hold(symbol: string, price: number, orderQuoteQty: number): CryptoSignal {
  return {
    symbol,
    action: "hold",
    score: 0,
    entryPrice: price,
    stopLoss: price,
    takeProfit: price,
    orderQuoteQty,
    reasons: ["Factor-label composite currently has no researched edge for this symbol"]
  };
}
