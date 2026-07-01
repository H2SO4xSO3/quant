# Bitget Composite Router Design

## Goal

Build a Bitget-first strategy router that combines trend continuation, pullback/reversion entry, and overextension exit ideas without requiring all branches to pass at the same time.

## Design

The router evaluates three independent branches against the same `CryptoMarketAnalysis`:

- Trend branch: use `aberration-volatility-breakout` as the continuation candidate.
- Reversion branch: use `vwap-pullback-reclaim` and `bollinger-breakeven` as low-buy candidates, choosing the strongest executable long.
- Exit branch: detect overheated long conditions with Bollinger upper band, VWAP extension, high RSI, and weak buy flow. This branch returns `sell` only as a position-management signal; it must not force a new short.

The router chooses one branch by market state. Strong bullish trend favors the trend branch. Sideways or pullback state favors reversion. Overextension exits override new entries. If branches conflict or no branch is executable, it returns `hold` with explicit branch blockers and preserves the strongest raw score.

## Evidence Posture

State starts as `observe_only`. Backtests and paper runs are biased evidence, not proof. Output must keep branch scores and blockers visible so later Bitget paper data can separate infrastructure health from strategy readiness.

## Scope

This change adds only a reusable strategy module and tests. It does not place live Bitget orders, change secrets, or enable trading.
