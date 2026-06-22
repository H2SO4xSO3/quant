import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export type PolymarketRecordKind = "market-metadata" | "price-snapshots" | "orderbooks" | "trades" | "resolutions" | "collector-errors";

export class JsonlPolymarketStore {
  constructor(private readonly dataDir: string) {}

  append(kind: PolymarketRecordKind, record: unknown): void {
    mkdirSync(this.dataDir, { recursive: true });
    appendFileSync(path.join(this.dataDir, `${kind}.jsonl`), `${JSON.stringify(record)}\n`, "utf8");
  }
}
