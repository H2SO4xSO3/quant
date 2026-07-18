# Task 1 Report: Extract Causal Threshold Events

## Implementation

- Added the required fresh below-to-above cooldown test.
- Added a public-interface regression test proving emitted events preserve the observation fields and only add `threshold`.
- Corrected `extractThresholdCrossings` to preserve `observation.symbol` instead of uppercasing it.
- Existing threshold crossing behavior remains: scores use `rawScore >= threshold`, events emit only on below-to-above transitions, state is tracked per symbol, and accepted events respect `cooldownMinutes`.

## Files Changed

- `src/crypto/bitgetVolumeSignalResearch.ts`
- `src/crypto/bitgetVolumeSignalResearch.test.ts`
- `.superpowers/sdd/task-1-report.md`

No package metadata or unrelated dirty files were changed.

## TDD Evidence

### RED

Command:

```powershell
npm.cmd test -- src/crypto/bitgetVolumeSignalResearch.test.ts
```

Result: expected failure. `8` tests passed and `1` failed. The new preservation test received `symbol: "BTCUSDT"` but expected `symbol: "btcusdt"`, proving the existing uppercase normalization violated the required event contract.

### GREEN

After the one-line implementation fix, the same command passed:

- Test files: `1 passed`
- Tests: `9 passed`

## Full Suite

Command:

```powershell
npm.cmd test
```

Result:

- Test files: `66 passed`
- Tests: `257 passed`
- Vitest exit code: `0`

`git diff --check` also passed with no whitespace errors.

## Self-Review

- Scope is limited to threshold event extraction and its public-interface tests.
- Input arrays remain non-mutating because the implementation sorts a copy.
- Per-symbol state, inclusive threshold comparison, fresh crossing requirement, cooldown, and threshold field are covered by tests or existing focused coverage.
- No debug instrumentation was added.

## Concerns

- This isolated worktree already contained the target module and test from prior Bitget event-study commits, plus later-slice functionality. The Task 1 change is therefore an incremental correction and test completion, not creation from an empty module.
- `npm.cmd run typecheck` was not required by the Task 1 brief and was not run.
- Existing unrelated modifications remain in `docs/superpowers/plans/2026-07-13-bitget-volume-signal-event-study.md` and `.superpowers/`; they were not staged.

## Important Task 1 Review Fix Evidence

### Finding

The cooldown test previously placed its second crossing after the cooldown, so it did not prove that a fresh crossing inside the cooldown is rejected.

### Test Change

Updated `src/crypto/bitgetVolumeSignalResearch.test.ts` with this sequence:

- accepted crossing at `0`
- reset below threshold at `600_000`
- fresh crossing inside the 60-minute cooldown at `1_800_000`, expected to be rejected
- reset below threshold at `2_400_000`
- fresh crossing after cooldown at `3_660_000`, expected to be accepted

The test now asserts the exact accepted timestamps: `[0, 3_660_000]`.

### Mutation RED

Temporarily bypassed the production cooldown condition in `src/crypto/bitgetVolumeSignalResearch.ts` by changing the acceptance guard to `if (crossed)`.

Command:

```powershell
npm.cmd test -- src/crypto/bitgetVolumeSignalResearch.test.ts
```

Result: expected failure. `8` tests passed and `1` failed. The cooldown test received `[0, 1_800_000, 3_660_000]` instead of `[0, 3_660_000]`, proving the new assertion detects the missing cooldown rejection.

### Restored GREEN

Restored the original production guard:

```typescript
if (crossed && observation.timestampMs - state.lastAcceptedMs >= cooldownMinutes * 60_000) {
```

The same focused command passed:

- Test files: `1 passed`
- Tests: `9 passed`
- Vitest exit code: `0`

### Scope Verification

- Production behavior was restored unchanged.
- Only `src/crypto/bitgetVolumeSignalResearch.test.ts` contains the fix.
- Existing plan and unrelated `.superpowers` changes were not staged.
