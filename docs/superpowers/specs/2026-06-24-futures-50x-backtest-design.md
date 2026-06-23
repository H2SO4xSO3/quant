# Futures 50x Backtest Design

## Goal

Add a futures-specific backtest path for the current paper strategies. The old spot backtest only opens `buy` positions and cannot validate `sell`/short, leverage, margin loss caps, or futures fee drag. This tool must test the same strategy interface used by paper trading without changing live or paper cron behavior.

## Scope

- Add a reusable futures backtest module.
- Support long and short entries from `CryptoSignal.action`.
- Model margin, notional, leverage, liquidation, stop loss, take profit, timeout, signal exit, fees, slippage, and price impact.
- Add a CLI runner that writes `data/futures-backtest-report.json`.
- Add package scripts for the active 50x selector and the video EMA structure strategy.

## Execution Model

For each symbol, historical 5m/15m klines produce the same kline-derived analysis used by the existing backtest. A `buy` signal opens a long; a `sell` signal opens a short. Position notional is `marginUsdt * leverage`; quantity is `notional / entryPrice`. On every later candle the engine checks liquidation first, then stop loss, take profit, timeout, and signal exit.

Net PnL uses the futures paper cost model: entry fee, exit fee, entry slippage, and entry price impact. Non-liquidation losses are capped at `-marginUsdt`. Liquidation exits are exactly `-marginUsdt`.

## Reporting

The report contains per-symbol trades, direction, reason, gross PnL, cost, net PnL, win rate, profit factor, drawdown, and aggregate portfolio totals with max position limits. It is a validation tool, not evidence for live trading.

## Tests

Tests cover long take profit, short take profit, liquidation cap, and portfolio aggregation limits. They use deterministic synthetic candles and stub strategies so failures point at futures execution logic rather than Binance data.
