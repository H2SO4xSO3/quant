import { loadPolymarketCollectorConfig } from "./config";
import { PolymarketCollector } from "./collector";
import { PublicPolymarketClient } from "./client";
import { JsonlPolymarketStore } from "./storage";

async function main(): Promise<void> {
  const config = loadPolymarketCollectorConfig();
  if (!config.enabled) {
    console.log("Polymarket collector is disabled. Set POLYMARKET_COLLECTOR_ENABLED=true to run it.");
    return;
  }

  const collector = new PolymarketCollector({
    config,
    client: new PublicPolymarketClient(config),
    store: new JsonlPolymarketStore(config.dataDir)
  });
  const summary = await collector.collectOnce();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
