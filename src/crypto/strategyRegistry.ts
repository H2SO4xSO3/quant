import type { CryptoStrategy } from "./strategyTypes";
import { aberrationVolatilityBreakoutStrategy } from "./strategies/aberrationVolatilityBreakout";
import { bollingerBreakevenStrategy } from "./strategies/bollingerBreakeven";
import { emaVwapQualityBreakoutStrategy } from "./strategies/emaVwapQualityBreakout";
import { factorLabelAltReboundStrategy } from "./strategies/factorLabelAltRebound";
import { factorLabelBnbBreakoutStrategy } from "./strategies/factorLabelBnbBreakout";
import { factorLabelCapitulationReclaimStrategy } from "./strategies/factorLabelCapitulationReclaim";
import { factorLabelCompositeStrategy } from "./strategies/factorLabelComposite";
import { factorLabelTrendBasketStrategy } from "./strategies/factorLabelTrendBasket";
import { futuresOpportunity50xStrategy } from "./strategies/futuresOpportunity50x";
import { videoEmaStructure50xStrategy } from "./strategies/videoEmaStructure50x";
import { vwapBreakdownShortStrategy } from "./strategies/vwapBreakdownShort";
import { vwapPullbackReclaimStrategy } from "./strategies/vwapPullbackReclaim";
import { emaVwapTrendStrategy } from "./strategy";

const strategies = [
  emaVwapTrendStrategy,
  emaVwapQualityBreakoutStrategy,
  bollingerBreakevenStrategy,
  aberrationVolatilityBreakoutStrategy,
  factorLabelCapitulationReclaimStrategy,
  factorLabelAltReboundStrategy,
  factorLabelBnbBreakoutStrategy,
  factorLabelCompositeStrategy,
  factorLabelTrendBasketStrategy,
  vwapPullbackReclaimStrategy,
  vwapBreakdownShortStrategy,
  futuresOpportunity50xStrategy,
  videoEmaStructure50xStrategy
];

export function getStrategyById(id = emaVwapTrendStrategy.id): CryptoStrategy {
  return strategies.find((strategy) => strategy.id === id) ?? emaVwapTrendStrategy;
}

export function listStrategies(): CryptoStrategy[] {
  return strategies;
}
