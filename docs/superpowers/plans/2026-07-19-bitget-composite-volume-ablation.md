# Bitget Composite Router Volume Ablation Implementation Plan

**Goal:** Build and run a causal paired ablation of the existing Bitget composite router with volume-score and crowding/flow filters.

**Architecture:** Add an optional public signal-observation callback to the futures backtest loop, then keep all volume joins, filter rules, labeling, statistics, and grading in a dedicated pure research module. A CLI loads frozen JSONL, fetches/caches Bitget 5m/15m/1h candles, captures router candidates, writes a forward-compatible ledger, and renders JSON/Chinese Markdown reports.

**Tech Stack:** TypeScript, Vitest, existing Bitget client/backtest modules, Node filesystem/crypto.

---

### Task 1: Expose Causal Router Decisions

**Files:**
- Modify: `src/crypto/futuresBacktest.ts`
- Modify: `src/crypto/futuresBacktest.test.ts`

1. Add a failing public-interface test asserting an optional observer receives every generated signal with the current 5m `openTime`, including signals evaluated while a position is open.
2. Run `npm.cmd test -- src/crypto/futuresBacktest.test.ts` and confirm RED.
3. Add `FuturesSignalObservation` and optional `observeSignal` without changing default backtest behavior.
4. Run the focused test and existing futures tests to GREEN.

### Task 2: Build Paired Filter and Label Logic

**Files:**
- Create: `src/crypto/bitgetCompositeVolumeAblation.ts`
- Create: `src/crypto/bitgetCompositeVolumeAblation.test.ts`

1. Add failing tests for executable candidate extraction, exit-only exclusion, 24h cooldown, causal latest-prior joins, stale/missing blockers, score-direction filter, fixed crowding/flow vetoes, forward labels, paired deltas, and hard-state grading.
2. Run the new test file and confirm RED due to missing module.
3. Implement one vertical slice at a time, rerunning the focused tests after each behavior.
4. Preserve stable candidate IDs and explicit `rawScore`/`blocked` output.

### Task 3: Add the Research CLI

**Files:**
- Create: `src/crypto/runBitgetCompositeVolumeAblation.ts`
- Create: `src/crypto/runBitgetCompositeVolumeAblation.test.ts`
- Modify: `package.json`

1. Add failing tests for argument parsing, candle cache conversion, report rendering, and source-count reconciliation.
2. Implement `--input`, `--output-dir`, and `--candle-cache-dir` orchestration using existing Bitget candle fetching and router/backtest modules.
3. Write `candidate-ledger.jsonl`, `report.json`, and `report-zh.md`; print the hard-state line.
4. Add `bitget-composite-volume-ablation` npm script and run focused tests plus typecheck.

### Task 4: Run Frozen Study and Verify

**Generated Files (ignored):**
- `data/bitget-composite-volume-ablation/market-contexts.jsonl`
- `data/bitget-composite-volume-ablation/candles-*.json`
- `data/bitget-composite-volume-ablation/candidate-ledger.jsonl`
- `data/bitget-composite-volume-ablation/report.json`
- `data/bitget-composite-volume-ablation/report-zh.md`

1. Reuse the frozen VPS JSONL from the prior event study and record its SHA-256.
2. Fetch/cache all required Bitget candle intervals over the exact context period with enough warmup.
3. Run the study once. Reconcile candidate counts, joins, decisions, labels, and pending outcomes.
4. Run `npm.cmd test`, `npm.cmd run typecheck`, and `git diff --check`.
5. Commit and push `codex/bitget-volume-router-ablation`. Do not deploy an execution gate.
