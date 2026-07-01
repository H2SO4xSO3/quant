import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { BitgetVolumeRecordKind } from "./bitgetVolumeCollector";

export class JsonlBitgetVolumeStore {
  constructor(private readonly dataDir: string) {}

  append(kind: BitgetVolumeRecordKind, record: unknown): void {
    mkdirSync(this.dataDir, { recursive: true });
    appendFileSync(path.join(this.dataDir, `${kind}.jsonl`), `${JSON.stringify(record)}\n`, "utf8");
  }
}
