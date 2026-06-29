import { describe, expect, it } from "vitest";
import { parseBitgetVolumeCollectorArgs } from "./runBitgetVolumeCollector";

describe("Bitget volume collector runner args", () => {
  it("parses symbols, period, product type, and data directory", () => {
    expect(
      parseBitgetVolumeCollectorArgs([
        "--symbols",
        "BTCUSDT,XRPUSDT",
        "--period",
        "15m",
        "--product-type",
        "USDT-FUTURES",
        "--data-dir",
        "data/custom-bitget"
      ])
    ).toEqual({
      symbols: ["BTCUSDT", "XRPUSDT"],
      period: "15m",
      productType: "USDT-FUTURES",
      dataDir: "data/custom-bitget"
    });
  });

  it("defaults to the BTC/XRP 5m Bitget research collector", () => {
    expect(parseBitgetVolumeCollectorArgs([])).toEqual({
      symbols: ["BTCUSDT", "XRPUSDT"],
      period: "5m",
      productType: "USDT-FUTURES",
      dataDir: "data/bitget-volume-history"
    });
  });
});
