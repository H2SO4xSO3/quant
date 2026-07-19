# Bitget Composite Router Volume Ablation Design

## Goal

Measure whether the collected Bitget volume, open-interest, funding, and crowding context improves the existing composite router. The study must compare the same router candidates so variant results are paired and interpretable.

## Research Question

The composite router owns entry generation and branch selection. The volume layer is secondary: it may confirm or veto an existing candidate, but it must not create a new trade or flip direction.

The tested variants are fixed before running the study:

1. `router_baseline`: accept every executable router candidate.
2. `volume_score_filter`: accept only when the causal volume observation has `rawScore >= 70` and its direction agrees with the router candidate.
3. `crowding_flow_veto`: accept unless strong adverse taker flow or directionally crowded funding/positioning creates an explicit risk veto.

This includes the strict score filter as a diagnostic, not as a proposed production gate. The veto variant represents the intended combination model: the router finds the opportunity and volume context removes avoidable risk.

## Candidate Generation

- Use the existing `bitget-composite-router` without changing its parameters.
- Evaluate it causally on Bitget 5m candles with existing 15m and 1h context.
- Record executable `buy`/`sell` decisions even when the execution simulator already has an open position.
- Ignore overextension `sell` signals marked `Exit invalidation:` because they close longs and are not fresh short candidates.
- Apply a fixed 24-hour same-symbol cooldown after candidate generation. This prevents repeated adjacent 5m signals from pretending to be independent observations.
- Record the selected branch from the router reason (`trend` or `reversion`).

## Causal Volume Join

- Reconstruct volume scores using only market-context rows available at each observation timestamp.
- Join each router candidate to the latest same-symbol volume observation whose timestamp is at or before the candidate timestamp.
- Reject joins older than 15 minutes as `volume_context_stale`.
- A missing or stale context blocks the two filtered variants but remains visible in baseline output.
- Preserve `rawScore`, direction, OI changes, taker imbalance, funding, long/short ratios, and explicit `blocked` reasons in every candidate ledger row.

## Fixed Filter Rules

`volume_score_filter` accepts when `rawScore >= 70` and direction agrees.

`crowding_flow_veto` blocks a long when either:

- taker-window imbalance is at most `-10%`; or
- crowd-long ratio is at least `1.25` and funding is above `0.008%`.

It blocks a short when either:

- taker-window imbalance is at least `10%`; or
- crowd-long ratio is at most `0.85` and funding is below `-0.002%`.

These values come from the existing observer's score boundaries and are not tuned against the outcome sample.

## Outcome Labels

- Enter at the first 5m candle open strictly after the candidate timestamp.
- Label direction-aware 1h, 4h, 12h, and 24h returns.
- Report 0.20% and 0.30% round-trip cost assumptions.
- Report completed and pending counts, mean, median, win rate, profit factor, MFE, MAE, and fixed-seed bootstrap 95% confidence intervals.
- Compare each filtered variant against its paired baseline subset using candidate IDs, not an unrelated market baseline.

## Outputs

The CLI writes:

- `candidate-ledger.jsonl`: candidate, branch, causal volume context, decisions, blockers, and forward labels.
- `report.json`: machine-readable assumptions, source hashes, coverage, counts, summaries, paired deltas, and grade.
- `report-zh.md`: concise Chinese result report with `action`, `rawScore`, `state`, `blocked`, `evidence`, and `next_check`.

No execution gate is connected. Generated files stay under ignored `data/`.

## Readiness Gate

The result remains `no_trade` when any primary comparison has fewer than 30 completed independent candidates, the 0.30% cost result is not positive, or the paired delta confidence interval crosses zero. It may advance only to `observe_only` when a filtered variant beats baseline at 0.20% and 0.30% costs with positive confidence intervals on at least three horizons. `sim_ready` requires separate forward paper evidence and is outside this change.

## Known Limits

- Current volume history covers only BTCUSDT and XRPUSDT and is short.
- Router analysis uses candle-derived flow/liquidity features, while the volume layer uses collected Bitget derivatives context.
- This is predictive association evidence, not causality.
- Multiple variants and horizons create multiple-testing risk; fixed rules and explicit diagnostic labeling reduce but do not remove it.

## First Frozen Run

Source snapshot SHA-256: `463c9442371271c11266c2f132e5623e1cae185ced9b8ab17fd7a0908b710848`.

- 11,242/11,242 valid context rows from `2026-06-29T15:21:43.867Z` through `2026-07-19T04:02:03.093Z`.
- 7,218 mature volume snapshots and 7,182 router observations.
- Five independent 24-hour-cooled candidates: three BTC trend candidates and two XRP reversion candidates.
- Baseline mean net returns at 0.20% cost were `-0.3450%`, `0.6850%`, `1.5536%`, and `1.8764%` at 1h, 4h, 12h, and 24h.
- `volume_score_filter` accepted zero candidates because all five causal volume scores were below 70.
- `crowding_flow_veto` accepted all five candidates, so its paired delta versus baseline was zero.
- Final grade: `action=hold`, `rawScore=67.2`, `state=no_trade`, `blocked=sample_too_small`, `evidence=paired_completed_max=5 required=30`.

The observer was deployed to `/opt/quant-bot` and scheduled daily at `04:40 UTC` (`12:40 Asia/Shanghai`) under cron marker `quant-bitget-composite-volume-ablation`. It remains disconnected from execution.
