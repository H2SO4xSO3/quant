# Futures Paper Cost-Aware Exits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 50x futures paper entries and daily reviews more cost-aware, with explicit blocked reasons and no live-trading changes.

**Architecture:** Keep strategy internals mostly unchanged. Add selector-level exit-quality blocking for executable signals, then improve daily-review interpretation of timeout/cost drag. This keeps raw signal scores visible while blocking weak net-edge paper entries.

**Tech Stack:** TypeScript, Vitest, existing `CryptoSignal`, `chooseBestOpportunitySignal`, `runDailyReview` data model.

---

### Task 1: Selector Exit-Quality Block

**Files:**
- Modify: `src/crypto/strategies/futuresOpportunity50x.ts`
- Test: `src/crypto/strategies/futuresOpportunity50x.test.ts`

- [ ] **Step 1: Write the failing test**

Append this test to `describe("futures 50x opportunity selector", ...)` in `src/crypto/strategies/futuresOpportunity50x.test.ts`:

```ts
  it("keeps raw score but blocks executable signals that do not clear the post-cost exit-quality floor", () => {
    const selected = chooseBestOpportunitySignal(
      [
        signal({
          action: "sell",
          score: 100,
          entryPrice: 100,
          stopLoss: 100.4,
          takeProfit: 99.1,
          reasons: ["short executable"]
        })
      ],
      { minExecutableTakeProfitPct: 0.8, minExitQualityTakeProfitPct: 1.2 }
    );

    expect(selected.action).toBe("hold");
    expect(selected.score).toBe(100);
    expect(selected.reasons.join(" ")).toContain("exit-quality floor");
    expect(selected.reasons.join(" ")).toContain("gross target 0.90%");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd test -- src/crypto/strategies/futuresOpportunity50x.test.ts
```

Expected: FAIL because `minExitQualityTakeProfitPct` is not part of `OpportunitySelectorOptions`.

- [ ] **Step 3: Write minimal implementation**

In `src/crypto/strategies/futuresOpportunity50x.ts`, extend options:

```ts
export interface OpportunitySelectorOptions {
  minExecutableTakeProfitPct?: number;
  minExitQualityTakeProfitPct?: number;
}
```

Add a helper:

```ts
function blockWeakExitQuality(signal: CryptoSignal, minExitQualityTakeProfitPct?: number): CryptoSignal {
  if (signal.action !== "buy" && signal.action !== "sell") {
    return signal;
  }
  if (minExitQualityTakeProfitPct === undefined) {
    return signal;
  }
  const grossTargetPct = targetPct(signal);
  if (grossTargetPct >= minExitQualityTakeProfitPct) {
    return signal;
  }
  return {
    ...signal,
    action: "hold",
    reasons: [
      ...signal.reasons,
      `Selector blocked ${signal.action}: gross target ${grossTargetPct.toFixed(2)}% does not clear ${minExitQualityTakeProfitPct.toFixed(2)}% exit-quality floor after 50x costs and timeout risk`
    ]
  };
}
```

Then apply it in `chooseBestOpportunitySignal`:

```ts
const costFilteredSignals = signals.map((signal) =>
  blockWeakExitQuality(
    blockThinTarget(blockNonMajor(signal), options.minExecutableTakeProfitPct),
    options.minExitQualityTakeProfitPct
  )
);
```

Set the default selector floor in `futuresOpportunity50xStrategy.generateSignal`:

```ts
{
  minExecutableTakeProfitPct: roundTripCostPct(input.config) * SELECTOR_COST_MULTIPLE,
  minExitQualityTakeProfitPct: roundTripCostPct(input.config) * (SELECTOR_COST_MULTIPLE + 2)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm.cmd test -- src/crypto/strategies/futuresOpportunity50x.test.ts
```

Expected: PASS.

### Task 2: Daily Review Exit-Quality Finding

**Files:**
- Modify: `src/crypto/dailyReview.ts`
- Test: `src/crypto/dailyReview.test.ts`

- [ ] **Step 1: Write the failing test**

Append a test to `src/crypto/dailyReview.test.ts` that builds a futures source with positive gross PnL, negative net PnL, and timeout exits. Assert findings mention exit quality and `observe_only`.

Use the existing test helpers in that file. If no helper fits, add a minimal journal entry array matching existing fixtures:

```ts
expect(review.findings.join(" ")).toContain("Timeout exits dominate");
expect(review.riskDebate.operatorDecision).toContain("observe_only");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd test -- src/crypto/dailyReview.test.ts
```

Expected: FAIL because timeout dominance does not yet create that finding or hard readiness wording.

- [ ] **Step 3: Write minimal implementation**

In `src/crypto/dailyReview.ts`, after existing findings are assembled, add:

```ts
if (totals.closedTrades > 0 && totals.avgHoldMinutes >= 50 && (review.byExitReason.timeout?.closedTrades ?? 0) / totals.closedTrades >= 0.5) {
  findings.push("Timeout exits dominate recent futures paper results; treat this as exit-quality risk, not proof of take-profit edge.");
}
```

Then make the conservative `operatorDecision` include `observe_only` when net PnL is negative or timeout/cost drag dominates:

```ts
operatorDecision: totals.netPnlUsdt <= 0 || findings.some((finding) => finding.includes("Timeout exits dominate"))
  ? "Keep this as paper-only observe_only research until net PnL, exit quality, and sample size improve."
  : "Keep this as paper-only research. Next change must be a strategy hypothesis with before/after evidence, not a silent threshold tweak."
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm.cmd test -- src/crypto/dailyReview.test.ts
```

Expected: PASS.

### Task 3: Verification and Deployment

**Files:**
- Verify all modified files.
- Deploy to VPS `/opt/quant-bot`.

- [ ] **Step 1: Run local focused tests**

```powershell
npm.cmd test -- src/crypto/strategies/futuresOpportunity50x.test.ts src/crypto/dailyReview.test.ts
```

- [ ] **Step 2: Run full local checks**

```powershell
npm.cmd run typecheck
npm.cmd test
```

- [ ] **Step 3: Deploy**

Copy changed source/test/docs files or pull from Git after commit if preferred. Because VPS repo may not be a git worktree, verify `/opt/quant-bot` state first.

- [ ] **Step 4: Verify VPS**

```bash
cd /opt/quant-bot
npm run typecheck
npm test -- src/crypto/strategies/futuresOpportunity50x.test.ts src/crypto/dailyReview.test.ts
npm run -s futures-paper-opportunity-50x:linux
npm run -s daily-review:linux -- 24
```

Expected: tests pass; paper run remains paper-only; output keeps `rawScore` and explicit blockers.

- [ ] **Step 5: Commit and push**

```powershell
git status --short
git add AGENTS.md docs/superpowers/specs/2026-06-25-futures-paper-cost-aware-exits-design.md docs/superpowers/plans/2026-06-25-futures-paper-cost-aware-exits.md src/crypto/strategies/futuresOpportunity50x.ts src/crypto/strategies/futuresOpportunity50x.test.ts src/crypto/dailyReview.ts src/crypto/dailyReview.test.ts
git commit -m "Improve futures paper exit-quality gates"
git push
```
