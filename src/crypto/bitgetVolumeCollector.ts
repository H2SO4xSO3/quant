import type { BitgetMarketContext, CollectBitgetMarketContextOptions } from "./bitgetMarketData";
import { collectBitgetMarketContext } from "./bitgetMarketData";

export type BitgetVolumeRecordKind = "market-contexts" | "collector-summaries" | "collector-errors";

export interface BitgetVolumeCollectorStore {
  append(kind: BitgetVolumeRecordKind, record: unknown): void;
}

export interface BitgetVolumeCollectionSummary {
  timestampReceived: string;
  symbols: number;
  contexts: number;
  blockers: number;
  errors: number;
}

export interface BitgetVolumeCollectorOptions {
  symbols: string[];
  period: string;
  productType: string;
  store: BitgetVolumeCollectorStore;
  collect?: (options: CollectBitgetMarketContextOptions) => Promise<BitgetMarketContext>;
  now?: () => string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class BitgetVolumeCollector {
  private readonly now: () => string;
  private readonly collectContext: (options: CollectBitgetMarketContextOptions) => Promise<BitgetMarketContext>;

  constructor(private readonly options: BitgetVolumeCollectorOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.collectContext = options.collect ?? collectBitgetMarketContext;
  }

  async collectOnce(): Promise<BitgetVolumeCollectionSummary> {
    const timestampReceived = this.now();
    const summary: BitgetVolumeCollectionSummary = {
      timestampReceived,
      symbols: this.options.symbols.length,
      contexts: 0,
      blockers: 0,
      errors: 0
    };

    for (const symbol of this.options.symbols) {
      try {
        const context = await this.collectContext({
          symbol,
          productType: this.options.productType,
          period: this.options.period
        });
        summary.contexts += 1;
        summary.blockers += context.blockers.length;
        this.options.store.append("market-contexts", { timestampReceived, ...context });
      } catch (error) {
        summary.errors += 1;
        this.options.store.append("collector-errors", {
          timestampReceived,
          symbol,
          message: errorMessage(error)
        });
      }
    }

    this.options.store.append("collector-summaries", summary);
    return summary;
  }
}
