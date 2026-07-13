# Bitget Volume Signal Event Study Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a reproducible one-time event study for the existing Bitget volume observation score, then write local JSON and Chinese Markdown reports.

**Architecture:** Keep statistical logic in one pure module and orchestration in one CLI. Reuse the production observation scorer for historical score reconstruction, reuse public Bitget futures candles for labels, and keep all report state hard-blocked from execution.

**Tech Stack:** TypeScript, Vitest, existing Bitget scorer/client modules, JSONL input, public Bitget USDT-FUTURES 5-minute candles.

## Global Constraints

- Do not modify or deploy the VPS collector or observer.
- Do not touch existing dirty files, including `package.json`.
- Use only information available at each observation timestamp.
- Enter on the first 5-minute candle strictly after an observation.
- Primary readiness evidence uses a 24-hour cooldown.
- Test thresholds 60, 65, and 70; horizons 1h, 4h, 12h, and 24h; round-trip costs 0%, 0.12%, 0.20%, and 0.30%.
- Maximum readiness is `observe_only`; default to `no_trade` with explicit blockers.
- Keep `rawScore` in the final report.

---

## File Structure

- Create `src/crypto/bitgetVolumeSignalResearch.ts`: pure event extraction, labeling, statistics, baseline, and grading.
- Create `src/crypto/bitgetVolumeSignalResearch.test.ts`: public-interface tests for every research invariant.
- Create `src/crypto/runBitgetVolumeSignalResearch.ts`: JSONL parsing, score reconstruction, candle retrieval/cache, and report rendering.
- Create `src/crypto/runBitgetVolumeSignalResearch.test.ts`: CLI helper and rendering tests with local fixtures.
- Create `data/bitget-volume-signal-research/report.json`: generated machine-readable result, ignored by Git.
- Create `data/bitget-volume-signal-research/report-zh.md`: generated Chinese result, ignored by Git.

### Task 1: Extract Causal Threshold Events

**Files:**
- Create: `src/crypto/bitgetVolumeSignalResearch.test.ts`
- Create: `src/crypto/bitgetVolumeSignalResearch.ts`

**Interfaces:**
- Consumes: ordered `ScoreObservation[]`.
- Produces: `extractThresholdCrossings(observations, threshold, cooldownMinutes): SignalEvent[]`.

- [ ] **Step 1: Write the failing crossing tests**

```ts
import { describe, expect, it } from "vitest";
import { extractThresholdCrossings } from "./bitgetVolumeSignalResearch";

describe("Bitget volume threshold events", () => {
  it("emits only the first crossing while a score remains above the threshold", () => {
    const events = extractThresholdCrossings([
      { symbol: "BTCUSDT", timestampMs: 0, direction: "long_watch", rawScore: 59 },
      { symbol: "BTCUSDT", timestampMs: 300_000, direction: "long_watch", rawScore: 70 },
      { symbol: "BTCUSDT", timestampMs: 600_000, direction: "long_watch", rawScore: 74 }
    ], 70, 0);
    expect(events.map((event) => event.timestampMs)).toEqual([300_000]);
  });

  it("requires a fresh below-to-above crossing after cooldown", () => {
    const events = extractThresholdCrossings([
      { symbol: "BTCUSDT", timestampMs: 0, direction: "short_watch", rawScore: 71 },
      { symbol: "BTCUSDT", timestampMs: 3_600_000, direction: "short_watch", rawScore: 68 },
      { symbol: "BTCUSDT", timestampMs: 7_200_000, direction: "short_watch", rawScore: 72 }
    ], 70, 60);
    expect(events).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- src/crypto/bitgetVolumeSignalResearch.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the event contract**

```ts
export type VolumeWatchDirection = "long_watch" | "short_watch";

export interface ScoreObservation {
  symbol: string;
  timestampMs: number;
  direction: VolumeWatchDirection;
  rawScore: number;
}

export interface SignalEvent extends ScoreObservation {
  threshold: number;
}

export function extractThresholdCrossings(
  observations: ScoreObservation[],
  threshold: number,
  cooldownMinutes: number
): SignalEvent[] {
  const state = new Map<string, { above: boolean; lastAcceptedMs: number }>();
  const events: SignalEvent[] = [];
  for (const row of [...observations].sort((a, b) => a.timestampMs - b.timestampMs)) {
    const prior = state.get(row.symbol) ?? { above: false, lastAcceptedMs: Number.NEGATIVE_INFINITY };
    const above = row.rawScore >= threshold;
    const crossing = above && !prior.above;
    if (crossing && row.timestampMs - prior.lastAcceptedMs >= cooldownMinutes * 60_000) {
      events.push({ ...row, threshold });
      prior.lastAcceptedMs = row.timestampMs;
    }
    prior.above = above;
    state.set(row.symbol, prior);
  }
  return events;
}
```

- [ ] **Step 4: Run GREEN**

Run: `npm.cmd test -- src/crypto/bitgetVolumeSignalResearch.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Commit the slice**

```powershell
git add src/crypto/bitgetVolumeSignalResearch.ts src/crypto/bitgetVolumeSignalResearch.test.ts
git commit -m "feat: extract Bitget volume threshold events"
```

### Task 2: Label Future Returns Without Look-Ahead

**Files:**
- Modify: `src/crypto/bitgetVolumeSignalResearch.ts`
- Modify: `src/crypto/bitgetVolumeSignalResearch.test.ts`

**Interfaces:**
- Consumes: `SignalEvent[]`, `ResearchPriceBar[]`, horizon, and cost.
- Produces: `labelSignalEvents(input): LabeledSignalEvent[]` with completed or pending labels.

- [ ] **Step 1: Add failing entry, direction, pending, cost, and excursion tests**

```ts
it("enters strictly after the observation and labels long and short returns", () => {
  const bars = [
    { symbol: "BTCUSDT", openTimeMs: 0, open: 100, high: 101, low: 99, close: 100 },
    { symbol: "BTCUSDT", openTimeMs: 300_000, open: 100, high: 103, low: 98, close: 102 },
    { symbol: "BTCUSDT", openTimeMs: 3_900_000, open: 102, high: 104, low: 101, close: 103 }
  ];
  const [long] = labelSignalEvents({
    events: [{ symbol: "BTCUSDT", timestampMs: 0, direction: "long_watch", rawScore: 70, threshold: 70 }],
    bars,
    horizonMinutes: 60,
    roundTripCostPct: 0.2
  });
  expect(long.entryTimeMs).toBe(300_000);
  expect(long.grossDirectionalReturnPct).toBeCloseTo(2);
  expect(long.netDirectionalReturnPct).toBeCloseTo(1.8);
});

it("keeps an event pending when the full horizon is unavailable", () => {
  const [label] = labelSignalEvents({ events, bars: bars.slice(0, 1), horizonMinutes: 60, roundTripCostPct: 0.2 });
  expect(label.status).toBe("pending");
});
```

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- src/crypto/bitgetVolumeSignalResearch.test.ts`

Expected: FAIL because `labelSignalEvents` is not exported.

- [ ] **Step 3: Implement labeling**

Add `ResearchPriceBar`, `LabeledSignalEvent`, and `labelSignalEvents`. Select the first bar with `openTimeMs > event.timestampMs`, select the first exit bar with `openTimeMs >= entryTimeMs + horizonMinutes * 60_000`, use entry and exit opens, calculate direction-aware MFE/MAE from bars before the exit, subtract the supplied round-trip cost once, and return `status="pending"` when entry or exit is unavailable.

- [ ] **Step 4: Run GREEN**

Run: `npm.cmd test -- src/crypto/bitgetVolumeSignalResearch.test.ts`

Expected: all event and label tests pass.

- [ ] **Step 5: Commit the slice**

```powershell
git add src/crypto/bitgetVolumeSignalResearch.ts src/crypto/bitgetVolumeSignalResearch.test.ts
git commit -m "feat: label Bitget volume signal outcomes"
```

### Task 3: Add Statistics, Baseline, and Hard-State Grading

**Files:**
- Modify: `src/crypto/bitgetVolumeSignalResearch.ts`
- Modify: `src/crypto/bitgetVolumeSignalResearch.test.ts`

**Interfaces:**
- Produces: `summarizeLabeledEvents`, `buildNonOverlappingBaseline`, `gradeVolumeSignalResearch`.

- [ ] **Step 1: Add failing summary and grading tests**

```ts
it("summarizes completed net returns and excludes pending labels", () => {
  const summary = summarizeLabeledEvents([completed(1), completed(-0.5), pending()]);
  expect(summary).toMatchObject({ completed: 2, pending: 1, meanNetReturnPct: 0.25, winRatePct: 50, profitFactor: 2 });
  expect(summary.meanCi95Pct).not.toBeNull();
});

it("blocks a small threshold-70 primary sample", () => {
  expect(gradeVolumeSignalResearch({ latestRawScores: { BTCUSDT: 62, XRPUSDT: 75 }, primaryCells: [cell(12, 0.4, [0.1, 0.7])] })).toMatchObject({
    state: "no_trade",
    blocked: "sample_too_small"
  });
});

it("blocks a sufficient sample whose confidence interval crosses zero", () => {
  expect(gradeVolumeSignalResearch({ latestRawScores: {}, primaryCells: [cell(40, 0.2, [-0.1, 0.5])] }).blocked).toBe("weak_forward_edge");
});
```

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- src/crypto/bitgetVolumeSignalResearch.test.ts`

Expected: FAIL on missing summary exports.

- [ ] **Step 3: Implement deterministic statistics**

Implement mean, median, win rate, profit factor, fixed-seed bootstrap mean confidence intervals, horizon-spaced same-symbol/direction baseline returns, and weighted signal-minus-baseline output. Grade only threshold-70, 24-hour-cooldown, 0.20%-cost cells. Require at least 30 completed events and positive confidence intervals in three horizons for `observe_only`; otherwise return `no_trade` with `sample_too_small` or `weak_forward_edge`.

- [ ] **Step 4: Run GREEN and typecheck**

Run:

```powershell
npm.cmd test -- src/crypto/bitgetVolumeSignalResearch.test.ts
npm.cmd run typecheck
```

Expected: focused tests and typecheck pass.

- [ ] **Step 5: Commit the slice**

```powershell
git add src/crypto/bitgetVolumeSignalResearch.ts src/crypto/bitgetVolumeSignalResearch.test.ts
git commit -m "feat: summarize and grade Bitget signal evidence"
```

### Task 4: Add the One-Time Research Runner

**Files:**
- Create: `src/crypto/runBitgetVolumeSignalResearch.ts`
- Create: `src/crypto/runBitgetVolumeSignalResearch.test.ts`

**Interfaces:**
- Consumes: `--input`, `--output-dir`, optional `--candle-cache-dir`.
- Produces: `report.json`, `report-zh.md`, and console hard-state output.

- [ ] **Step 1: Write failing JSONL and Markdown tests**

```ts
it("counts malformed JSONL rows instead of silently replacing them", () => {
  const result = parseStoredContextJsonl(`${JSON.stringify(validContext)}\nnot-json\n`);
  expect(result.contexts).toHaveLength(1);
  expect(result.invalidRows).toBe(1);
});

it("renders rawScore state blocked evidence and next_check", () => {
  const markdown = renderChineseVolumeSignalReport(reportFixture);
  expect(markdown).toContain("rawScore");
  expect(markdown).toContain("state=no_trade");
  expect(markdown).toContain("blocked=sample_too_small");
  expect(markdown).toContain("next_check");
});
```

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- src/crypto/runBitgetVolumeSignalResearch.test.ts`

Expected: FAIL because the runner module does not exist.

- [ ] **Step 3: Implement orchestration**

Implement exported argument parsing, JSONL parsing, SHA-256 hashing, per-symbol causal score reconstruction through `buildBitgetVolumeObservationReports`, public 5-minute candle fetching through `fetchBitgetHistoryCandles`, cache read/write, report matrix generation for all thresholds/horizons/costs/cooldowns, and Chinese Markdown rendering. Keep the CLI guarded by the existing `fileURLToPath(import.meta.url) === process.argv[1]` pattern.

- [ ] **Step 4: Run GREEN**

Run:

```powershell
npm.cmd test -- src/crypto/runBitgetVolumeSignalResearch.test.ts src/crypto/bitgetVolumeSignalResearch.test.ts
npm.cmd run typecheck
```

Expected: focused tests and typecheck pass.

- [ ] **Step 5: Commit the slice**

```powershell
git add src/crypto/runBitgetVolumeSignalResearch.ts src/crypto/runBitgetVolumeSignalResearch.test.ts
git commit -m "feat: add Bitget volume signal research runner"
```

### Task 5: Freeze Inputs, Run the Study, and Verify

**Files:**
- Generate: `data/bitget-volume-signal-research/market-contexts.jsonl`
- Generate: `data/bitget-volume-signal-research/candles-*.json`
- Generate: `data/bitget-volume-signal-research/report.json`
- Generate: `data/bitget-volume-signal-research/report-zh.md`

- [ ] **Step 1: Copy the current VPS JSONL without changing the VPS**

Run:

```powershell
New-Item -ItemType Directory -Force 'data\bitget-volume-signal-research' | Out-Null
scp -i "$HOME\.ssh\quant_vultr_ed25519" root@167.179.110.244:/opt/quant-bot/data/bitget-volume-history/market-contexts.jsonl 'data\bitget-volume-signal-research\market-contexts.jsonl'
```

Expected: local file exists and remote collection continues.

- [ ] **Step 2: Run the one-time study**

Run:

```powershell
$env:NODE_USE_ENV_PROXY='1'
npx.cmd tsx src/crypto/runBitgetVolumeSignalResearch.ts --input data/bitget-volume-signal-research/market-contexts.jsonl --output-dir data/bitget-volume-signal-research
```

Expected: JSON and Markdown reports are written; console prints `action=hold`, latest `rawScore`, `state`, `blocked`, `evidence`, and `next_check`.

- [ ] **Step 3: Reconcile report counts**

Verify source rows equal valid plus invalid rows, each completed label has an entry and exit candle, pending labels are excluded from statistics, and primary event counts do not exceed threshold-crossing counts.

- [ ] **Step 4: Run the full verification gate**

Run:

```powershell
npm.cmd test
npm.cmd run typecheck
git diff --check
```

Expected: all tests pass, typecheck exits 0, and no whitespace errors exist in the new files.

- [ ] **Step 5: Verify VPS collection remains live**

Run live read-only checks for `quant-bitget-volume-collector`, the latest JSONL timestamp, and `volume-observe-latest.json`. Expected: collector and observer timestamps continue advancing.

