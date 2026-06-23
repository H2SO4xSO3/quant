# Paper 50x Risk Gate Design

## Goal

Reduce the current paper-account bleed without merging the two strategies. Keep both strategies in simulation only and preserve separate journals/logs.

## Video EMA Structure Strategy

The video strategy should no longer enter immediately after a 1h support/resistance break. It must treat the 1h break as context, then require a nearby retest/continuation entry:

- The current price must still be on the breakout side of the broken level.
- Distance from the broken 1h level must be inside a bounded retest window, avoiding both no-break noise and late chase entries.
- The existing 5m EMA order, RSI, candle body, close location, volume, and 2R take-profit rules stay active.

Add a Chan direction gate:

- Longs require Chan trend up, price above pivot/no pivot, no bearish divergence, and no center-chop setup.
- Shorts require Chan trend down, price below pivot/no pivot, no bullish divergence, and no center-chop setup.
- Missing Chan structure should block executable entries instead of silently allowing 50x.

## Futures Opportunity 50x Selector

The selector should avoid trades whose gross target is too thin for 50x friction. A selected executable signal must have a take-profit distance that clears a stronger cost floor before the selector returns buy/sell. Otherwise it is converted to hold with an explicit blocker.

## Verification

Add behavior tests first:

- Video strategy blocks late chase entries far from the 1h broken level.
- Video strategy blocks shorts against Chan uptrend.
- Video strategy allows a short only after a nearby support retest plus Chan downtrend.
- 50x selector converts an otherwise executable signal to hold when gross target does not clear the selector cost floor.

Then run targeted strategy tests, full typecheck, full test suite, deploy to VPS, run one manual paper cycle for each affected strategy, verify logs/data advance, commit and push.
