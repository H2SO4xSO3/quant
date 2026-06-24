# Futures Paper Cost-Aware Exit Design

## Scope

Only Binance crypto futures paper strategies are in scope. Live trading remains off. A-share, Polymarket, and US equities are out of scope.

## Problem

The 50x paper system can show strong gross moves while still failing net after fees, slippage, and timeout exits. Recent live paper evidence shows:

- `futures-opportunity-50x`: gross positive, net still slightly negative after costs.
- `video-ema-structure-50x`: weak gross edge and worse net edge.
- Recent winners mostly exited by timeout, not take-profit.

Per the Obsidian quant kernel, the system should optimize net robustness, not surface return. High `rawScore` must remain visible, but executable entries need clearer cost and exit-quality evidence.

## Edge Hypothesis

The candidate edge is not "EMA/VWAP is predictive" by itself. The testable hypothesis is:

> A 50x entry is only worth paper execution when structure, flow, and target distance imply enough post-cost room before timeout. Signals that can only win by a small timeout drift are not robust enough.

The counterparty is short-horizon traders entering late into breakdown/reclaim moves, plus liquidity providers collecting spread and fees when momentum stalls.

## Design

1. Add a reusable exit-quality check for executable futures signals.
   - Keep `score` as raw technical score.
   - Convert executable `buy`/`sell` to `hold` when expected target distance does not clear a stricter post-cost floor.
   - Add a precise blocker reason.

2. Apply it at selector level before choosing the executable branch.
   - This keeps strategy internals simple.
   - It works for both long and short candidate branches.
   - It avoids editing live trading paths.

3. Improve daily review interpretation.
   - When timeout exits dominate and costs consume gross PnL, report this as exit-quality/cost-drag evidence.
   - Keep infrastructure health separate from strategy readiness.
   - Use hard readiness wording: `observe_only` until paper evidence improves.

## Data Flow

Candidate strategies generate raw signals -> selector applies symbol and cost/exit quality blockers -> label research gate applies recent bucket evidence -> futures paper cycle records scan/open/close -> daily review summarizes net, gross, costs, exit reasons, readiness.

## Tests

Add focused tests before implementation:

- Selector blocks an otherwise executable signal when gross target is below the stricter futures floor, preserving raw score and blocker reason.
- Daily review marks timeout-dominated positive-gross/negative-net results as exit-quality and cost-drag evidence.

## Non-Goals

- No live-trading switch.
- No new exchange orders.
- No broad threshold mining.
- No Polymarket cleanup in this change.
- No claim that backtests prove edge.

## Deployment

Run local tests and typecheck. Deploy code to `/opt/quant-bot`, run focused tests or equivalent verification there, then verify cron/log behavior. Commit and push to `H2SO4xSO3/quant`.
