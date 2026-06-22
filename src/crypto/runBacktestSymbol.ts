import { BinanceClient } from "./binanceClient";
import { loadCryptoBotConfig } from "./config";
import { backtestSymbol } from "./backtest";
import { parseBacktestSymbolArgs } from "./backtestStrategyArgs";
import { getStrategyById } from "./strategyRegistry";

const config = loadCryptoBotConfig();
const parsed = parseBacktestSymbolArgs(process.argv.slice(2), config.strategy);
const symbol = parsed.symbol || config.symbols[0];
const days = parsed.days;
const strategy = parsed.strategy;
const client = new BinanceClient({ baseUrl: config.baseUrl });

backtestSymbol({
  client,
  symbol,
  days,
  orderQuoteQty: config.risk.maxOrderUsdt,
  strategy,
  signalStrategy: getStrategyById(parsed.strategyId)
})
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
