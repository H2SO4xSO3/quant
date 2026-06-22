import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CryptoJournalEntry } from "./types";

export interface CryptoJournalState {
  entries: CryptoJournalEntry[];
}

export class CryptoJournal {
  constructor(private readonly filePath: string) {}

  read(): CryptoJournalState {
    if (!existsSync(this.filePath)) {
      return { entries: [] };
    }

    try {
      return JSON.parse(readFileSync(this.filePath, "utf8")) as CryptoJournalState;
    } catch {
      return { entries: [] };
    }
  }

  write(state: CryptoJournalState): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  append(entry: CryptoJournalEntry): CryptoJournalEntry {
    const state = this.read();
    const next = { ...entry, id: entry.id ?? `crypto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
    this.write({ entries: [next, ...state.entries].slice(0, 500) });
    return next;
  }

  update(id: string, updater: (entry: CryptoJournalEntry) => CryptoJournalEntry): CryptoJournalEntry | undefined {
    const state = this.read();
    let updated: CryptoJournalEntry | undefined;
    const entries = state.entries.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }
      updated = updater(entry);
      return updated;
    });
    this.write({ entries });
    return updated;
  }
}
