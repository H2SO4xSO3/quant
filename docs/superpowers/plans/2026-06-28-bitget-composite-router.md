# Bitget Composite Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bitget-first composite strategy router that combines trend, low-buy, and high-sell behavior without requiring all branch standards to pass together.

**Architecture:** Create a focused strategy file that delegates to existing branch strategies, adds an overextension exit detector, then chooses the correct branch by regime. Register the strategy ID so existing backtest/paper paths can load it.

**Tech Stack:** TypeScript, Vitest, existing `CryptoStrategy` interface.

---

### Task 1: Composite Router Behavior

**Files:**
- Create: `src/crypto/strategies/bitgetCompositeRouter.test.ts`
- Create: `src/crypto/strategies/bitgetCompositeRouter.ts`
- Modify: `src/crypto/strategyRegistry.ts`

- [ ] Write tests for trend-only, reversion-only, overextension-exit, and conflict-hold behavior.
- [ ] Run `npm.cmd test -- src/crypto/strategies/bitgetCompositeRouter.test.ts` and verify RED.
- [ ] Implement minimal router with delegated branches and explicit reasons.
- [ ] Register `bitget-composite-router`.
- [ ] Run targeted tests, typecheck, and full tests.
