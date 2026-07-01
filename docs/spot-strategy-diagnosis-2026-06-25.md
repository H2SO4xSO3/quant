# Binance Spot Strategy Diagnosis - 2026-06-25

Scope: Binance spot only. No futures, no leverage, no lending, no live-key changes.

## Current Entry Logic

Default spot signal generation is deterministic. AI review runs only after a deterministic `buy` signal and can only approve or veto; it does not create the raw signal.

`ema-vwap-trend` scores 5m EMA trend, price above EMA trend, 15m EMA confirmation, RSI, VWAP distance, value-area position, footprint imbalance, large-trade buy ratio, order-book imbalance, and ATR. It then applies hard gates: 5m bullish, 15m bullish, price above VWAP, VWAP distance within configured band, EMA fast slope floor, 15m EMA gap floor, RSI band, ATR cap, minimum gross take-profit, minimum expected value after estimated costs, spread cap, value-area position, bid support, and at least two bullish flow confirmations.

`ema-vwap-quality-breakout` is stricter and more breakout-like: 5m bullish trend, 15m bullish trend with gap, price above value area, VWAP distance between 0.4% and 0.9%, EMA slope floor, RSI 52-67, minimum take-profit, expected value, and spread cap.

## Current Exit Logic

Backtest exits long spot positions by this priority: stop loss, take profit, timeout, signal exit. Before exit, breakeven and trailing-stop logic can lift the stop after configured profit triggers.

Paper trading exits by this priority: stop loss, take profit, signal invalidation/low score, timeout. Timeout can defer a tiny gross winner if estimated costs still make it net-negative, but only during a grace window.

## Engineering Risk Controls vs Trading Edge

Engineering controls:
- AI review veto gate.
- Backtest guard.
- Risk limits, max positions, max order size, cooldown.
- Min take-profit, expected-value, spread, slippage, price-impact gates.
- Stop loss, timeout, breakeven, trailing stop.

Potential edge candidates:
- Trend continuation after 15m/5m alignment.
- VWAP reclaim or breakout behavior.
- Value-area breakout/reclaim behavior.
- Footprint/order-book confirmation.

The current code mostly proves controls exist. It does not prove that these signals have positive expectancy out of sample.

## Low Win Rate / Loss Risk Hypotheses

1. Indicator stacking may delay entry until price has already moved. This is most visible in `ema-vwap-quality-breakout`: it requires bullish 5m, bullish 15m, above value area, VWAP extension, slope, and RSI confirmation. That can become late momentum chasing.
2. Small take-profit targets can be eaten by spot fee, slippage, price impact, and spread. A 0.5%-0.9% gross target may not survive realistic friction if entries are late.
3. Backtest guard prevents obviously bad recent reports from opening trades, but it is not proof of edge. It can also overfit to the most recent window if relied on too heavily.
4. Synthetic historical depth/footprint in backtest can overstate signal quality. Paper/live logs need to carry the real diagnostics.
5. Timeout and signal exits can turn weak entries into churn if the strategy enters during chop and exits after drift/cost drag.
6. A long-only spot strategy can look good in broad upside beta and fail in bearish or sideways regimes.

## Current Posture

State: `observe_only`.

Reason: recent low win rate and losses imply the system has not proven statistical edge. The correct next step is diagnosis, attribution, and ablation across 14/30/60/90 day windows, not parameter optimization.