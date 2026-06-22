import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlPolymarketStore } from "./storage";

describe("polymarket jsonl storage", () => {
  it("appends records without overwriting older snapshots", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "polymarket-store-"));

    try {
      const store = new JsonlPolymarketStore(dir);
      store.append("price-snapshots", { timestampReceived: "2026-05-28T00:00:00.000Z", marketId: "m1", midPrice: 0.5 });
      store.append("price-snapshots", { timestampReceived: "2026-05-28T00:00:05.000Z", marketId: "m1", midPrice: 0.51 });

      const lines = readFileSync(path.join(dir, "price-snapshots.jsonl"), "utf8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).midPrice).toBe(0.5);
      expect(JSON.parse(lines[1]).midPrice).toBe(0.51);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
