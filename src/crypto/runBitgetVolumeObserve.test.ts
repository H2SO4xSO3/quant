import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runBitgetVolumeObserve } from "./runBitgetVolumeObserve";

let tempDir: string | undefined;

function createTempDir(): string {
  tempDir = mkdtempSync(path.join(tmpdir(), "bitget-volume-observe-"));
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("runBitgetVolumeObserve", () => {
  it("reads persisted Bitget JSONL and writes observe-only reports", async () => {
    const dir = createTempDir();
    const input = path.join(dir, "market-contexts.jsonl");
    const output = path.join(dir, "volume-observe.json");
    const base = {
      symbol: "BTCUSDT",
      productType: "USDT-FUTURES",
      period: "5m",
      fundingRates: [{ symbol: "BTCUSDT", timestampMs: 1_000, fundingRate: 0.000027 }],
      takerBuySell: Array.from({ length: 30 }, (_, index) => ({ timestampMs: 1_000 + index, buyVolume: 95.62, sellVolume: 104.38 })),
      longShort: [{ timestampMs: 1_000, longRatio: 0.65, shortRatio: 0.35, longShortRatio: 1.851 }],
      accountLongShort: [{ timestampMs: 1_000, longAccountRatio: 0.66, shortAccountRatio: 0.34, longShortAccountRatio: 1.976 }],
      positionLongShort: [{ timestampMs: 1_000, longPositionRatio: 0.493, shortPositionRatio: 0.507, longShortPositionRatio: 0.974 }],
      blockers: []
    };

    writeFileSync(
      input,
      `${JSON.stringify({
        ...base,
        timestampReceived: "2026-06-29T15:21:43.867Z",
        openInterest: { symbol: "BTCUSDT", timestampMs: 1_000, openInterest: 35_337.32 }
      })}\n${JSON.stringify({
        ...base,
        timestampReceived: "2026-07-01T16:07:04.109Z",
        openInterest: { symbol: "BTCUSDT", timestampMs: 2_000, openInterest: 35_015.76 }
      })}\n`,
      "utf8"
    );

    const reports = await runBitgetVolumeObserve(["--input", input, "--output", output, "--min-hours", "168"]);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      symbol: "BTCUSDT",
      action: "hold",
      rawScore: 56.2,
      state: "observe_only"
    });
    expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({ reports });
  });
});
