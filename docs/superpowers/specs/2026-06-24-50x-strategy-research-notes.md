# 50x Strategy Research Notes

## Findings

- The old `futures-opportunity-50x` selector used the spot `ema-vwap-trend` long branch. In futures backtest it produced 22 trades, all effectively long exposure, with `-133.2610U`, 13.64% win rate, PF 0.116, and 3 liquidations over 14 days.
- Lowering leverage reduces loss size but does not improve edge. The same entries had the same weak win rate and PF at 30x, 20x, and 10x.
- The video EMA structure strategy originally showed 0 trades because the futures backtest did not pass `hourlyStructure` or Chan structure into historical strategy analysis. After fixing that verifier gap, it produced 14 trades and `-19.9922U`.
- The largest remaining damage came from altcoin noise and stop distances too wide for 50x. SOL, DOGE, and XRP were the active losing symbols after removing the old EMA branch.
- Binance futures fees apply on open and close, and liquidation happens when margin balance falls below maintenance margin. With 50x leverage, entries must have tight invalidation and low noise.

## Changes Made

- Futures backtest now passes 1h structure and Chan structure into strategies.
- The 50x selector now uses `video-ema-structure-50x` instead of the old spot EMA long branch.
- Video EMA structure now uses nearest invalidation instead of the farthest support/resistance level.
- Video EMA structure blocks entries whose stop distance is wider than 1.2%.
- Video EMA structure caps holding time at 60 minutes.
- The 50x selector blocks non-major symbols from execution: BTCUSDT, ETHUSDT, and BNBUSDT only.

## Current Result

After the changes, the 14-day futures backtest for `futures-opportunity-50x` produced 0 trades, 0U net PnL, and 0 liquidations. This is not a profitable strategy. It is a safer observation gate that prevents the previous losing trades from executing while the paper system continues collecting evidence.
