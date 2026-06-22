import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePaperEventLogPath, resolvePaperJournalPath, resolvePaperStrategyId } from "./paperPaths";

describe("paper runtime paths", () => {
  it("uses the legacy paper files by default", () => {
    const cwd = path.resolve("tmp/project");

    expect(resolvePaperJournalPath({}, cwd)).toBe(path.resolve(cwd, "data/paper-journal.json"));
    expect(resolvePaperEventLogPath({}, cwd)).toBe(path.resolve(cwd, "data/paper-events.json"));
  });

  it("lets A/B paper runs isolate journal and event files", () => {
    const cwd = path.resolve("tmp/project");
    const env = {
      PAPER_JOURNAL_PATH: "data/paper-reclaim-journal.json",
      PAPER_EVENTS_PATH: "data/paper-reclaim-events.json"
    };

    expect(resolvePaperJournalPath(env, cwd)).toBe(path.resolve(cwd, "data/paper-reclaim-journal.json"));
    expect(resolvePaperEventLogPath(env, cwd)).toBe(path.resolve(cwd, "data/paper-reclaim-events.json"));
  });

  it("lets paper runs override the configured strategy without changing .env", () => {
    expect(resolvePaperStrategyId("ema-vwap-trend", { PAPER_STRATEGY_ID: "vwap-pullback-reclaim" })).toBe("vwap-pullback-reclaim");
    expect(resolvePaperStrategyId("ema-vwap-trend", {})).toBe("ema-vwap-trend");
  });
});
