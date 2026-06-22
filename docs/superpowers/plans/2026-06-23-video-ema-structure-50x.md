# Video EMA Structure 50x Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone paper futures strategy copied from the video subtitles: 1h structure bias, 5m EMA trend entry, RSI momentum, strong candle push, and 1:2 risk reward.

**Architecture:** Keep the existing `futures-opportunity-50x` unchanged. Add 1h market structure as analysis data, add a new `video-ema-structure-50x` strategy, register it, give it independent journal/events/log paths, and include it as a separate daily review source.

**Tech Stack:** TypeScript, Vitest, existing BinanceClient/analyzeMarket/futuresPaper runner.

---

### Task 1: Add 1h Structure Analysis

**Files:**
- Modify: `src/crypto/types.ts`
- Modify: `src/crypto/binanceClient.ts`
- Modify: `src/crypto/indicators.ts`
- Test: `src/crypto/indicators.test.ts`

- [ ] Write a failing test that passes hourly klines into `analyzeMarket` and expects `technical.hourlyStructure` to report direction and broken structure.
- [ ] Implement `hourlyKlines` fetch in `BinanceClient.fetchMarket` without changing existing 15m `higherKlines`.
- [ ] Implement `computeHourlyStructure` using recent 1h swing high/low ranges.
- [ ] Run the targeted indicator test.

### Task 2: Add Video EMA Structure Strategy

**Files:**
- Create: `src/crypto/strategies/videoEmaStructure50x.ts`
- Create: `src/crypto/strategies/videoEmaStructure50x.test.ts`
- Modify: `src/crypto/strategyRegistry.ts`
- Modify: `src/crypto/strategy.ts`

- [ ] Write failing tests for long, short, center/no-breakout hold, and weak candle hold.
- [ ] Implement 5m EMA21/50/200 ordering, RSI momentum, strong candle push away from EMA21/50, 1h bias gate, and 1:2 trade plan.
- [ ] Register strategy id `video-ema-structure-50x`.
- [ ] Run targeted strategy tests.

### Task 3: Add Independent Runtime Paths

**Files:**
- Modify: `package.json`
- Modify: `src/crypto/dailyReviewRunner.ts`
- Test: `src/crypto/dailyReviewRunner.test.ts`

- [ ] Add script `futures-paper-video-ema-structure-50x:linux` using separate journal/events paths.
- [ ] Add daily review source `video-ema-structure-50x` without merging it into `futures-opportunity-50x` stats.
- [ ] Update daily review test to expect two separate sources.

### Task 4: Verify and Deploy

**Files:**
- No code-only files.

- [ ] Run `npm.cmd run typecheck`.
- [ ] Run `npm.cmd test`.
- [ ] If SSH works, back up VPS files, scp changes, add a cron line for `futures-paper-video-ema-structure-50x:linux`, run remote typecheck/tests, and verify `crontab -l`.
