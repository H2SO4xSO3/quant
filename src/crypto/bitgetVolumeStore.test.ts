import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonlBitgetVolumeStore } from "./bitgetVolumeStore";

describe("Bitget volume JSONL store", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appends records under one file per record kind", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bitget-volume-store-"));
    dirs.push(dir);
    const store = new JsonlBitgetVolumeStore(dir);

    store.append("market-contexts", { symbol: "BTCUSDT" });
    store.append("market-contexts", { symbol: "XRPUSDT" });
    store.append("collector-summaries", { contexts: 2 });

    expect(readJsonl(path.join(dir, "market-contexts.jsonl"))).toEqual([{ symbol: "BTCUSDT" }, { symbol: "XRPUSDT" }]);
    expect(readJsonl(path.join(dir, "collector-summaries.jsonl"))).toEqual([{ contexts: 2 }]);
  });
});

function readJsonl(filePath: string): unknown[] {
  return readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
}
