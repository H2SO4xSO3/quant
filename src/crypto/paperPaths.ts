import path from "node:path";

type PaperEnv = Record<string, string | undefined>;

function resolveRuntimePath(value: string | undefined, fallback: string, cwd: string): string {
  return path.resolve(cwd, value?.trim() || fallback);
}

export function resolvePaperJournalPath(env: PaperEnv = process.env, cwd = process.cwd()): string {
  return resolveRuntimePath(env.PAPER_JOURNAL_PATH, "data/paper-journal.json", cwd);
}

export function resolvePaperEventLogPath(env: PaperEnv = process.env, cwd = process.cwd()): string {
  return resolveRuntimePath(env.PAPER_EVENTS_PATH, "data/paper-events.json", cwd);
}

export function resolvePaperStrategyId(defaultStrategyId: string, env: PaperEnv = process.env): string {
  return env.PAPER_STRATEGY_ID?.trim() || defaultStrategyId;
}
