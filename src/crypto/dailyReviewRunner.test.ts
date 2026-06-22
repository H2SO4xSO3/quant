import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDailyReviewFromFiles } from "./dailyReviewRunner";
import type { CryptoJournalEntry } from "./types";

const tempDirs: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "daily-review-"));
  tempDirs.push(dir);
  return dir;
}

function writeJournal(root: string, relativePath: string, entries: CryptoJournalEntry[]): void {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");
}

describe("daily review runner", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reviews unified 50x and video EMA structure 50x as separate paper strategies", () => {
    const root = tempRoot();
    writeJournal(root, "data/paper-ema-vwap-journal.json", [
      {
        symbol: "BTCUSDT",
        side: "SELL",
        price: 100.2,
        quantity: 0.2,
        quoteQty: 20.04,
        realizedPnlUsdt: -0.0142,
        open: false,
        timestamp: "2026-06-16T00:30:00.000Z",
        mode: "paper",
        notes: ["Paper timeout exit", "Estimated paper costs 0.054200U"]
      },
      {
        symbol: "BTCUSDT",
        side: "BUY",
        price: 100,
        quantity: 0.2,
        quoteQty: 20,
        realizedPnlUsdt: 0,
        open: false,
        timestamp: "2026-06-16T00:00:00.000Z",
        mode: "paper"
      }
    ]);
    writeJournal(root, "data/futures-opportunity-50x-journal.json", [
      {
        symbol: "ETHUSDT",
        side: "BUY",
        direction: "short",
        leverage: 50,
        price: 99.6,
        quantity: 4,
        quoteQty: 398.4,
        marginUsdt: 20,
        notionalUsdt: 398.4,
        realizedPnlUsdt: 1.1,
        open: false,
        timestamp: "2026-06-16T01:30:00.000Z",
        mode: "futures_paper",
        notes: ["Futures paper take_profit exit", "Futures short 50x", "Estimated futures costs 0.50U", "Gross futures PnL 1.60U"]
      },
      {
        symbol: "ETHUSDT",
        side: "SELL",
        direction: "short",
        leverage: 50,
        price: 100,
        quantity: 4,
        quoteQty: 20,
        marginUsdt: 20,
        notionalUsdt: 400,
        realizedPnlUsdt: 0,
        open: false,
        timestamp: "2026-06-16T01:00:00.000Z",
        mode: "futures_paper"
      }
    ]);

    writeJournal(root, "data/video-ema-structure-50x-journal.json", [
      {
        symbol: "SOLUSDT",
        side: "SELL",
        direction: "long",
        leverage: 50,
        price: 102,
        quantity: 10,
        quoteQty: 1020,
        marginUsdt: 20,
        notionalUsdt: 1020,
        realizedPnlUsdt: 2.0,
        open: false,
        timestamp: "2026-06-16T03:30:00.000Z",
        mode: "futures_paper",
        notes: ["Futures paper take_profit exit", "Video 1h bias is long after resistance breakout", "Estimated futures costs 0.70U", "Gross futures PnL 2.70U"]
      },
      {
        symbol: "SOLUSDT",
        side: "BUY",
        direction: "long",
        leverage: 50,
        price: 100,
        quantity: 10,
        quoteQty: 20,
        marginUsdt: 20,
        notionalUsdt: 1000,
        realizedPnlUsdt: 0,
        open: false,
        timestamp: "2026-06-16T02:30:00.000Z",
        mode: "futures_paper"
      }
    ]);
    const result = runDailyReviewFromFiles({
      cwd: root,
      now: new Date("2026-06-16T16:00:00.000Z"),
      windowHours: 24,
      initialCapitalUsdt: 100,
      outputDir: "data/reviews"
    });

    expect(result.review.totals.closedTrades).toBe(2);
    expect(result.latestMarkdownPath).toBe(path.join(root, "data/reviews/daily-review-latest.md"));
    expect(result.datedJsonPath).toBe(path.join(root, "data/reviews/daily-review-2026-06-17.json"));
    expect(readFileSync(result.latestMarkdownPath, "utf8")).toContain("Daily Strategy Review");
    const latest = JSON.parse(readFileSync(result.latestJsonPath, "utf8"));
    expect(Object.keys(latest.sources)).toEqual(["futures-opportunity-50x", "video-ema-structure-50x"]);
    expect(latest.sources["paper-ema-vwap"]).toBeUndefined();
    expect(latest.sources["futures-long-20x"]).toBeUndefined();
    expect(latest.sources["futures-opportunity-50x"]).toBeDefined();
    expect(latest.sources["futures-opportunity-50x"].closedTrades).toBe(1);
    expect(latest.sources["video-ema-structure-50x"].closedTrades).toBe(1);
  });
});