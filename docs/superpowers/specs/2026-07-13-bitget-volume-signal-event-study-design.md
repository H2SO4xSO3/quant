# Bitget Volume Signal Event Study Design

## Goal

Evaluate whether the existing Bitget volume observation score predicts directional BTCUSDT or XRPUSDT futures returns. Produce a one-time local JSON report and a concise Chinese Markdown report. Do not deploy a new VPS job and do not connect the result to execution.

## Scope

- Input: the current VPS `market-contexts.jsonl` dataset and public Bitget USDT futures candles.
- Symbols: BTCUSDT and XRPUSDT.
- Score thresholds: 60, 65, and 70.
- Forward horizons: 1h, 4h, 12h, and 24h.
- Round-trip cost scenarios: 0%, 0.12%, 0.20%, and 0.30%.
- Outputs: one machine-readable JSON file and one Chinese Markdown report under local `data/`.
- No VPS mutation, paper trading, live trading, parameter optimization, or leverage study.

## Research Method

### Causal score reconstruction

For every stored context timestamp, reconstruct the existing observation score using only rows available at or before that timestamp. A score becomes eligible only after the symbol has 168 hours of prior context. This preserves the production scoring formula and prevents future context from entering an earlier score.

### Event definition

An event occurs when a symbol's score first crosses from below a threshold to at or above that threshold. The event direction is the scorer's `long_watch` or `short_watch` direction at that timestamp. Repeated high scores do not create repeated events until the score falls below the threshold and crosses again.

The tradeable timestamp is the open of the first 5-minute candle strictly after the observation timestamp. This models collection and decision latency and prevents same-bar look-ahead.

### Dependence control

The primary sample applies a 24-hour cooldown per symbol and threshold, so primary 24-hour outcomes do not overlap. Diagnostic tables also use horizon-specific cooldowns of 1h, 4h, 12h, and 24h. The primary readiness decision uses the conservative 24-hour-cooldown sample; diagnostic samples cannot upgrade readiness.

### Outcomes

For each event and horizon, calculate:

- gross directional return
- net directional return under each cost scenario
- maximum favorable excursion
- maximum adverse excursion

Long events use price return directly. Short events negate price return. Funding is reported from the context but is not credited as profit because exact account settlement is unavailable; this biases the result against claiming an edge.

### Baseline

Build a deterministic same-symbol, same-direction baseline from eligible non-overlapping 5-minute candle starts over the same research period. Compare signal mean and median returns with baseline mean and median returns for the same horizon and cost assumption.

### Statistics

Each threshold, direction, and horizon cell reports:

- completed event count
- mean and median net return
- win rate
- profit factor
- 95% bootstrap confidence interval for mean net return using a fixed seed
- baseline mean and median
- signal-minus-baseline mean

Cells with fewer than two completed events report no confidence interval. Events without a complete future horizon are marked pending and excluded from completed statistics.

## Readiness Decision

The report always preserves the latest `rawScore`, but the research state is independent of the latest score.

- `state=no_trade`, `blocked=sample_too_small` when the primary threshold-70 sample has fewer than 30 completed events for every horizon.
- `state=no_trade`, `blocked=weak_forward_edge` when samples are sufficient but net signal-minus-baseline return is non-positive or its 95% confidence interval includes zero.
- Maximum possible state for this one-time study is `observe_only`; it cannot produce `sim_ready` or a live state.
- An `observe_only` result requires at least 30 completed primary events, positive 0.20%-cost net excess return, a confidence interval above zero, and consistent sign across at least three horizons.

## Components

### `src/crypto/bitgetVolumeSignalResearch.ts`

Pure research functions and types:

- threshold-crossing extraction
- cooldown enforcement
- next-candle entry matching
- forward return and excursion labeling
- deterministic bootstrap and baseline summaries
- hard-state grading

### `src/crypto/bitgetVolumeSignalResearch.test.ts`

Public-interface tests for:

- no repeated events while a score remains above a threshold
- no same-bar entry
- long and short directional return signs
- incomplete future horizons remaining pending
- cost subtraction
- cooldown behavior
- sample and weak-edge blockers

### `src/crypto/runBitgetVolumeSignalResearch.ts`

CLI orchestration only:

1. Read the frozen local JSONL copy.
2. Reconstruct historical scores with the existing scorer.
3. Fetch or read cached Bitget 5-minute candles.
4. Run the pure event-study module.
5. Write JSON and Chinese Markdown reports.

No existing `package.json` script is required; run with `npx tsx` to avoid touching the dirty package file.

## Data and Failure Handling

- Invalid JSONL rows are counted and reported; they are never silently replaced.
- Missing score fields produce `blocked=data_missing` for the affected symbol.
- Candle gaps, missing entry candles, and incomplete horizons remain explicit pending or rejected labels.
- API fetch failure leaves the cached input untouched and exits without writing a misleading completed report.
- Every report records source file hash, row count, first/last timestamps, candle coverage, assumptions, and generation time.

## Verification

- Follow red-green TDD for every pure behavior.
- Run the focused Vitest file after each slice.
- Run the full test suite and TypeScript typecheck before reporting completion.
- Independently reconcile source row counts, score event counts, pending labels, and completed labels.
- Keep the VPS collector and observer unchanged throughout the study.

