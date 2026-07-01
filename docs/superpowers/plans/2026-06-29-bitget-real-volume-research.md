# Bitget Real Volume Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Bitget-native market-data research layer that can reject or qualify strategies using real volume, open interest, funding, and positioning evidence before any live or paper upgrade.

**Architecture:** Keep strategy logic behind the existing registry. Add a separate research data layer that normalizes Bitget futures market context into typed snapshots, then run walk-forward analysis before creating any new entry rule. Missing historical data must become `blocked=data_missing`, not a synthetic substitute.

**Tech Stack:** TypeScript, Vitest, existing `src/crypto/*` modules, Bitget USDT-FUTURES REST data, local JSON reports under `data/`.

---

## File Structure

- Create `src/crypto/bitgetMarketData.ts`: Bitget futures market-data adapter and parsers.
- Create `src/crypto/bitgetMarketData.test.ts`: parser and missing-field tests.
- Create `src/crypto/bitgetVolumeFeatures.ts`: normalize candles, OI, funding, and positioning into research features.
- Create `src/crypto/bitgetVolumeFeatures.test.ts`: deterministic feature tests with small fixtures.
- Create `src/crypto/bitgetVolumeResearch.ts`: walk-forward research engine and evidence grading.
- Create `src/crypto/bitgetVolumeResearch.test.ts`: walk-forward and readiness-state tests.
- Create `src/crypto/runBitgetVolumeResearch.ts`: CLI runner that writes a local JSON report.
- Modify `src/crypto/strategyRegistry.ts`: no live candidate registration from this research until gates pass.
- Modify `src/crypto/strategyRegistry.test.ts`: assert research candidates default to `observe_only` or `no_trade`.
- Create `docs/bitget-volume-research-notes.md`: human-readable research output.

## Task 1: Freeze Current Strategy Readiness

**Files:**
- Modify: `src/crypto/strategyRegistry.ts`
- Modify: `src/crypto/strategyRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

Add a registry test that resolves `bitget-composite-router` and asserts it is not exposed as a live-ready strategy.

```ts
it("keeps bitget composite router out of live readiness after 365d failure", () => {
  const strategy = getStrategyDefinition("bitget-composite-router");

  expect(strategy.id).toBe("bitget-composite-router");
  expect(strategy.readiness).not.toBe("live_ready");
  expect(["research_only", "observe_only", "no_trade"]).toContain(strategy.readiness);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd test -- src/crypto/strategyRegistry.test.ts
```

Expected: fail if `readiness` is not represented yet.

- [ ] **Step 3: Add the minimal readiness field**

Add a typed readiness field to strategy definitions if missing, then set `bitget-composite-router` to `no_trade`.

```ts
readiness: "no_trade",
blockedReason: "365d Bitget native futures backtest failed: return -232.4085%, PF 0.5253, maxDD 258.7426%",
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm.cmd test -- src/crypto/strategyRegistry.test.ts
```

Expected: pass.

## Task 2: Add Bitget Market Data Parser

**Files:**
- Create: `src/crypto/bitgetMarketData.ts`
- Create: `src/crypto/bitgetMarketData.test.ts`

- [ ] **Step 1: Write parser tests**

```ts
import { describe, expect, it } from "vitest";
import { parseBitgetFundingRows, parseBitgetOpenInterestRows } from "./bitgetMarketData";

describe("bitget market data parsers", () => {
  it("parses open interest rows into timestamped numeric values", () => {
    const rows = [["1710000000000", "12345.67"]];

    expect(parseBitgetOpenInterestRows(rows)).toEqual([
      { timestampMs: 1710000000000, openInterest: 12345.67 },
    ]);
  });

  it("parses funding rows into timestamped rates", () => {
    const rows = [{ fundingTime: "1710000000000", fundingRate: "0.0001" }];

    expect(parseBitgetFundingRows(rows)).toEqual([
      { timestampMs: 1710000000000, fundingRate: 0.0001 },
    ]);
  });

  it("rejects missing historical market fields instead of fabricating values", () => {
    expect(() => parseBitgetOpenInterestRows([["1710000000000"]])).toThrow(/blocked=data_missing/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd test -- src/crypto/bitgetMarketData.test.ts
```

Expected: fail with missing module.

- [ ] **Step 3: Implement parsers**

```ts
export interface BitgetOpenInterestPoint {
  timestampMs: number;
  openInterest: number;
}

export interface BitgetFundingPoint {
  timestampMs: number;
  fundingRate: number;
}

const parseFiniteNumber = (value: unknown, field: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`blocked=data_missing field=${field}`);
  }
  return parsed;
};

export const parseBitgetOpenInterestRows = (rows: unknown[][]): BitgetOpenInterestPoint[] =>
  rows.map((row) => {
    if (row.length < 2) {
      throw new Error("blocked=data_missing field=openInterest");
    }
    return {
      timestampMs: parseFiniteNumber(row[0], "timestampMs"),
      openInterest: parseFiniteNumber(row[1], "openInterest"),
    };
  });

export const parseBitgetFundingRows = (rows: Array<Record<string, unknown>>): BitgetFundingPoint[] =>
  rows.map((row) => ({
    timestampMs: parseFiniteNumber(row.fundingTime, "fundingTime"),
    fundingRate: parseFiniteNumber(row.fundingRate, "fundingRate"),
  }));
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm.cmd test -- src/crypto/bitgetMarketData.test.ts
```

Expected: pass.

## Task 3: Build Volume Feature Snapshots

**Files:**
- Create: `src/crypto/bitgetVolumeFeatures.ts`
- Create: `src/crypto/bitgetVolumeFeatures.test.ts`

- [ ] **Step 1: Write feature tests**

```ts
import { describe, expect, it } from "vitest";
import { buildBitgetVolumeFeature } from "./bitgetVolumeFeatures";

describe("bitget volume features", () => {
  it("classifies breakout continuation with volume and OI expansion", () => {
    const feature = buildBitgetVolumeFeature({
      closePctChange: 0.8,
      volumeRatio: 2.1,
      openInterestPctChange: 1.4,
      fundingRate: 0.0002,
      longShortRatio: 1.05,
    });

    expect(feature.regime).toBe("volume_breakout_confirmation");
    expect(feature.blocked).toBeUndefined();
  });

  it("blocks missing true market context", () => {
    const feature = buildBitgetVolumeFeature({
      closePctChange: 0.8,
      volumeRatio: 2.1,
      openInterestPctChange: null,
      fundingRate: 0.0002,
      longShortRatio: 1.05,
    });

    expect(feature.regime).toBe("blocked");
    expect(feature.blocked).toBe("blocked=data_missing field=openInterestPctChange");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd test -- src/crypto/bitgetVolumeFeatures.test.ts
```

Expected: fail with missing module.

- [ ] **Step 3: Implement feature builder**

```ts
export type BitgetVolumeRegime =
  | "volume_breakout_confirmation"
  | "pullback_volume_contraction"
  | "crowded_positioning_risk"
  | "neutral"
  | "blocked";

export interface BitgetVolumeFeatureInput {
  closePctChange: number;
  volumeRatio: number;
  openInterestPctChange: number | null;
  fundingRate: number | null;
  longShortRatio: number | null;
}

export interface BitgetVolumeFeature {
  regime: BitgetVolumeRegime;
  blocked?: string;
}

const missing = (field: string): BitgetVolumeFeature => ({
  regime: "blocked",
  blocked: `blocked=data_missing field=${field}`,
});

export const buildBitgetVolumeFeature = (input: BitgetVolumeFeatureInput): BitgetVolumeFeature => {
  if (input.openInterestPctChange === null) return missing("openInterestPctChange");
  if (input.fundingRate === null) return missing("fundingRate");
  if (input.longShortRatio === null) return missing("longShortRatio");

  if (input.closePctChange > 0.5 && input.volumeRatio >= 1.8 && input.openInterestPctChange > 1) {
    return { regime: "volume_breakout_confirmation" };
  }
  if (Math.abs(input.closePctChange) < 0.25 && input.volumeRatio < 0.8) {
    return { regime: "pullback_volume_contraction" };
  }
  if (Math.abs(input.fundingRate) > 0.001 || input.longShortRatio > 2 || input.longShortRatio < 0.5) {
    return { regime: "crowded_positioning_risk" };
  }
  return { regime: "neutral" };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm.cmd test -- src/crypto/bitgetVolumeFeatures.test.ts
```

Expected: pass.

## Task 4: Add Walk-Forward Research Gate

**Files:**
- Create: `src/crypto/bitgetVolumeResearch.ts`
- Create: `src/crypto/bitgetVolumeResearch.test.ts`

- [ ] **Step 1: Write readiness tests**

```ts
import { describe, expect, it } from "vitest";
import { gradeBitgetVolumeResearch } from "./bitgetVolumeResearch";

describe("bitget volume research gate", () => {
  it("returns no_trade when one-year evidence is negative", () => {
    const result = gradeBitgetVolumeResearch({
      trades: 54,
      returnPct: -232.4085,
      maxDrawdownPct: 258.7426,
      profitFactor: 0.5253,
      walkForwardPasses: 0,
      walkForwardWindows: 4,
    });

    expect(result.state).toBe("no_trade");
    expect(result.blocked).toContain("blocked=negative_expectancy");
  });

  it("allows observe_only but not sim_ready before paper evidence", () => {
    const result = gradeBitgetVolumeResearch({
      trades: 140,
      returnPct: 18,
      maxDrawdownPct: 12,
      profitFactor: 1.35,
      walkForwardPasses: 3,
      walkForwardWindows: 4,
    });

    expect(result.state).toBe("observe_only");
    expect(result.nextCheck).toContain("paper");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd test -- src/crypto/bitgetVolumeResearch.test.ts
```

Expected: fail with missing module.

- [ ] **Step 3: Implement readiness gate**

```ts
export interface BitgetVolumeResearchMetrics {
  trades: number;
  returnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  walkForwardPasses: number;
  walkForwardWindows: number;
}

export interface BitgetVolumeResearchGrade {
  state: "no_trade" | "observe_only";
  blocked: string;
  nextCheck: string;
}

export const gradeBitgetVolumeResearch = (metrics: BitgetVolumeResearchMetrics): BitgetVolumeResearchGrade => {
  if (metrics.returnPct <= 0 || metrics.profitFactor < 1.15) {
    return {
      state: "no_trade",
      blocked: `blocked=negative_expectancy returnPct=${metrics.returnPct} profitFactor=${metrics.profitFactor}`,
      nextCheck: "replace hypothesis; do not tune leverage",
    };
  }

  if (metrics.trades < 80) {
    return {
      state: "no_trade",
      blocked: `blocked=sample_too_small trades=${metrics.trades}`,
      nextCheck: "collect broader symbol/time evidence",
    };
  }

  if (metrics.maxDrawdownPct > 20) {
    return {
      state: "no_trade",
      blocked: `blocked=drawdown_too_high maxDrawdownPct=${metrics.maxDrawdownPct}`,
      nextCheck: "reduce risk or reject hypothesis",
    };
  }

  if (metrics.walkForwardWindows === 0 || metrics.walkForwardPasses / metrics.walkForwardWindows < 0.6) {
    return {
      state: "no_trade",
      blocked: `blocked=walk_forward_failed passes=${metrics.walkForwardPasses}/${metrics.walkForwardWindows}`,
      nextCheck: "inspect regime sensitivity",
    };
  }

  return {
    state: "observe_only",
    blocked: "blocked=paper_evidence_missing",
    nextCheck: "run 2-4 weeks paper before sim_ready",
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm.cmd test -- src/crypto/bitgetVolumeResearch.test.ts
```

Expected: pass.

## Task 5: Add CLI Report Runner

**Files:**
- Create: `src/crypto/runBitgetVolumeResearch.ts`
- Modify: `package.json`

- [ ] **Step 1: Add script**

Add:

```json
"bitget-volume-research": "tsx src/crypto/runBitgetVolumeResearch.ts"
```

- [ ] **Step 2: Write runner smoke test command**

Run:

```powershell
npm.cmd run bitget-volume-research -- --days 365 --symbols BTCUSDT,XRPUSDT --output data/bitget-volume-research-365d.json
```

Expected before implementation: command fails because runner does not exist.

- [ ] **Step 3: Implement runner output contract**

The runner must write:

```json
{
  "exchange": "bitget",
  "productType": "USDT-FUTURES",
  "days": 365,
  "symbols": ["BTCUSDT", "XRPUSDT"],
  "state": "no_trade",
  "blocked": "blocked=...",
  "evidence": {
    "featureCoveragePct": 0,
    "walkForward": {
      "passes": 0,
      "windows": 0
    }
  }
}
```

- [ ] **Step 4: Verify all relevant tests**

Run:

```powershell
npm.cmd test -- src/crypto/bitgetMarketData.test.ts src/crypto/bitgetVolumeFeatures.test.ts src/crypto/bitgetVolumeResearch.test.ts src/crypto/strategyRegistry.test.ts
npm.cmd run typecheck
```

Expected: all pass.

## Non-Negotiable Gates

- Historical true market-context data missing: `state=no_trade`, `blocked=data_missing`.
- One-year negative expectancy: `state=no_trade`.
- Walk-forward failure: `state=no_trade`.
- Paper evidence missing after research passes: max `state=observe_only`.
- User has not explicitly confirmed live upgrade: no live route.
- 25x+ full-margin configs: prohibited as readiness evidence.

## Report Output Requirement

Every research report must include:

```text
symbol=...
action=hold
rawScore=...
state=no_trade | observe_only
blocked=...
evidence=...
next_check=...
```

No silent holds. No synthetic volume presented as true order flow.
