import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CryptoJournal } from "./journal";

describe("crypto journal", () => {
  it("persists and reloads local trade records", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "crypto-journal-"));
    const store = new CryptoJournal(path.join(directory, "journal.json"));

    try {
      store.append({ symbol: "BTCUSDT", side: "BUY", quoteQty: 5, realizedPnlUsdt: 0, open: true, timestamp: "2026-05-19T00:00:00Z" });
      const reloaded = new CryptoJournal(path.join(directory, "journal.json"));

      expect(reloaded.read().entries).toHaveLength(1);
      expect(reloaded.read().entries[0].id).toMatch(/^crypto_/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
