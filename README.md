# Binance Spot Quant Bot

这是一个本地运行的币安现货量化机器人。它只做现货，不做合约、不做杠杆、不做借贷。

## 当前安全开关

- `LIVE_TRADING=false`：默认禁止自动开新仓。
- `LIVE_EXIT_TRADING=true/false`：只控制已有本地持仓触发止损/止盈时是否自动卖出。
- `MAX_ORDER_USDT=10`：单次买入上限。
- `BACKTEST_INITIAL_CAPITAL_USDT=100`：回测按 100U 组合本金计算收益率和回撤。
- `MAX_POSITION_LOSS_USDT=1.2`：单仓计划亏损上限。
- `DAILY_MAX_LOSS_USDT=3`：当天已实现亏损保护线。
- `MAX_OPEN_POSITIONS=4`：最多同时持有 4 个不同币种仓位。

API key、secret、DeepSeek key 都只放本地 `.env`，不要发到聊天里。

## 入口

- `Start-Quant-Dashboard.cmd`：启动控制台并打开 `http://127.0.0.1:8790`。
- `Stop-Quant-Dashboard.cmd`：停止控制台。
- `Run-Backtest.cmd`：重新跑最近 14 天回测。
- `Run-Status.cmd`：查看配置、持仓和最近日志。
- `Run-Scan-Once.cmd`：只扫描一次，不启动循环。

## 服务器运行方式

现在的代码已经按服务器长期运行来设计：买入循环会按剩余仓位批量处理多个候选信号，卖出守护会遍历全部开放仓位。浏览器页面只是控制台，真正需要常驻的是 Node 服务和网络连接。

## 当前策略

默认策略已经切到保守模式：

- 5m EMA 趋势必须看多。
- 15m EMA 趋势必须看多。
- 价格必须在 VWAP 上方，但不能追太远。
- 5m EMA 斜率必须有足够动量。
- 15m EMA 快慢线必须有足够间距。
- RSI 必须在 50-72。
- 止盈距离必须足够覆盖双边手续费。
- 入场必须通过成本调整后的期望值检查。
- 回测会估算双边手续费、滑点和价格冲击。
- 同一个币交易后默认冷却 180 分钟。
- 浮盈达到阈值后自动抬高保护止损，先保本，再进入移动止损。

代码现在支持策略模块替换。默认实盘仍使用 `ema-vwap-trend`，回测候选池会额外比较 `bollinger-breakeven`：

- `ema-vwap-trend`：趋势跟随，要求 EMA/VWAP/RSI/成本过滤同时通过。
- `bollinger-breakeven`：布林带下沿触碰后的现货做多均值回归，目标是先回到保本区，再尝试吃中轨附近的小利润。

`bollinger-breakeven` 是根据“触碰布林带边缘后，先判断能否回到 breakeven，再判断是否多吃一小段利润”的研究思路落成的规则版候选策略。它不是 XGBoost 模型，暂时也不做空、不加杠杆；下一步如果继续这个方向，应先导出触边样本和标签，再训练/验证模型。

回测候选池的 `best` 不再只按净利润排序，而是参考 QuantDinger 的多因子实验评分思路，综合收益、Profit Factor、最大回撤、胜率、交易样本数和资金利用率打分。这样可以减少“单一收益偶然最高但结构很脆”的候选被误选。

这些参数可在 `.env` 调整：

```env
MIN_BUY_SCORE=80
STRATEGY_ID=ema-vwap-quality-breakout
MIN_PRICE_VWAP_PCT=0.4
MAX_PRICE_VWAP_PCT=0.9
MIN_EMA_FAST_SLOPE_PCT=0.08
MIN_HIGHER_TREND_GAP_PCT=0.05
MIN_TAKE_PROFIT_PCT=0.55
MIN_EXPECTED_VALUE_PCT=0.08
ESTIMATED_SLIPPAGE_PCT=0.03
PRICE_IMPACT_PCT=0.04
MAX_SPREAD_PCT=0.18
ENTRY_COOLDOWN_MINUTES=180
BREAKEVEN_TRIGGER_PCT=0.45
TRAILING_STOP_TRIGGER_PCT=0.75
TRAILING_STOP_GIVEBACK_PCT=0.35
SIGNAL_EXIT_SCORE=42
MAX_HOLDING_MINUTES=60
```

## AI 复核

AI 不是下单大脑，只是最后一道复核门。确定性策略没有买入信号时不会调用 AI；确定性策略给出买入信号后，如果开启 AI 复核，AI 只能批准或否决，不能越过风控强行买。

DeepSeek V4 Pro 的 OpenAI-compatible 配置：

```env
AI_REVIEW_ENABLED=true
DEEPSEEK_API_KEY=你的本地key
AI_REVIEW_BASE_URL=https://api.deepseek.com
AI_REVIEW_MODEL=deepseek-v4-pro
AI_REVIEW_TIMEOUT_MS=8000
```

如果 `AI_REVIEW_ENABLED=true` 但 key 缺失或接口失败，程序会直接否决这次买入。

## 回测健康闸门

默认开启最近回测健康检查。即使实时信号和 AI 都通过，只要最近回测报告不是正收益、Profit Factor 不达标、交易数太少或报告太旧，程序也不会开新仓。并且每个币也要单独通过自己的回测健康检查，避免整体赚钱但某个币一直拖后腿。

```env
BACKTEST_GUARD_ENABLED=true
BACKTEST_MIN_NET_PNL_USDT=0
BACKTEST_MIN_PROFIT_FACTOR=1
BACKTEST_MIN_TRADES=5
BACKTEST_MAX_AGE_HOURS=36
BACKTEST_REQUIRE_SYMBOL_HEALTH=true
BACKTEST_MIN_SYMBOL_NET_PNL_USDT=0
BACKTEST_MIN_SYMBOL_PROFIT_FACTOR=1
BACKTEST_MIN_SYMBOL_TRADES=3
```

## 验证

常用检查：

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run backtest
```

回测使用历史 K 线和 K 线推导出来的确认指标，不包含真实盘口滑点，也不能证明未来盈利。

## Polymarket collector

The optional `polymarket_collector` module is separate from the Binance spot strategy. It is data-only: no wallet, no private keys, no orders, and no signal mixing with the current strategy.

Default `.env` values keep it off:

```env
POLYMARKET_COLLECTOR_ENABLED=false
POLYMARKET_TIMEFRAMES=15m
POLYMARKET_SYMBOLS=BTC,ETH,SOL
POLYMARKET_POLL_INTERVAL_SECONDS=5
POLYMARKET_SAVE_ORDERBOOK=true
POLYMARKET_SAVE_TRADES=true
```

When enabled, records are appended under `data/polymarket/*.jsonl`:

- `market-metadata.jsonl`
- `price-snapshots.jsonl`
- `orderbooks.jsonl`
- `trades.jsonl`
- `resolutions.jsonl`
- `collector-errors.jsonl`

Manual one-shot collection:

```powershell
npm.cmd run polymarket
```

VPS/Linux one-shot collection:

```bash
npm run polymarket:linux
```
