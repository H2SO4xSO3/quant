# Bitget Volume Observe Mainline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Bitget volume research code to the repository mainline and add a durable observe-only score command for persisted collector data.

**Architecture:** Keep collection separate from scoring. The collector writes JSONL on the VPS; the observer reads that JSONL, groups by symbol, emits `hold/rawScore/state/blocked/evidence`, and never creates an executable trading signal.

**Tech Stack:** TypeScript, Vitest, JSONL files, existing Bitget market context types.

---

### Task 1: Restore Bitget Pipeline

**Files:**
- Restore: Bitget collector, research, strategy reset, and docs from commit `70fa886`.

- [x] **Step 1: Restore reverted code without committing**

Run: `git revert --no-commit b0cd6dc7255c8c1199db7c7812e3972cc942ef82`

Expected: Bitget files return to the worktree.

### Task 2: Add Observe-Only Score Model

**Files:**
- Create: `src/crypto/bitgetVolumeObservation.test.ts`
- Create: `src/crypto/bitgetVolumeObservation.ts`

- [x] **Step 1: Write failing tests**

The tests assert that weak and immature data stays `observe_only` with explicit blockers.

- [x] **Step 2: Implement minimal scorer**

The scorer groups persisted contexts by symbol and computes long/short watch scores from taker imbalance, open-interest change, funding, and crowding.

### Task 3: Add CLI

**Files:**
- Create: `src/crypto/runBitgetVolumeObserve.test.ts`
- Create: `src/crypto/runBitgetVolumeObserve.ts`
- Modify: `package.json`

- [x] **Step 1: Write failing CLI test**

The test writes fixture JSONL, runs the command API, and verifies report output.

- [x] **Step 2: Implement CLI**

The CLI reads JSONL, writes optional JSON output, and prints one `symbol=... action=hold rawScore=... state=observe_only blocked=...` line per symbol.

### Task 4: Verify And Deploy

**Files:**
- Deploy to: `/opt/quant-bot/src/crypto`

- [ ] **Step 1: Run local targeted tests**

Run: `npm.cmd test -- src/crypto/bitgetVolumeObservation.test.ts src/crypto/runBitgetVolumeObserve.test.ts`

- [ ] **Step 2: Run full local verification**

Run: `npm.cmd run typecheck` and `npm.cmd test`

- [ ] **Step 3: Copy observer files to VPS and run against live JSONL**

Run the observer on `/opt/quant-bot/data/bitget-volume-history/market-contexts.jsonl`.

- [ ] **Step 4: Commit and push**

Commit to `main` if allowed; otherwise push a `codex/` branch and report the blocker.
