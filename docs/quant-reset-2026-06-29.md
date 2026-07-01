# 量化项目清算报告 - 2026-06-29

## 硬结论

```text
strategy=bitget-composite-router
action=hold
rawScore=0
state=no_trade
blocked=Bitget native futures 365d backtest failed after the 90d branch-gated configuration was extended out of sample.
evidence=365d return -232.4085%, profitFactor 0.5253, maxDrawdown 258.7426%, totals trades 54, array trades 55, skippedTrades 1.
next_check=stop parameter tuning; build real Bitget volume/open-interest/funding research layer before any new strategy candidate.
```

现在不能实盘。也不能模拟成“快要可以实盘”。

这份报告的目的不是美化过程，是止损：把过去两个月变成可复用资产，把不能交易的策略明确下架。

## 项目范围

- 工作空间：`C:\Users\h2so4\Documents\量化`
- 交易域：crypto quant
- 当前用户方向：以后基于 Bitget
- 当前状态：`no_trade`
- 禁止项：不要再用短窗漂亮回测推动实盘；不要再靠提高杠杆满足收益目标；不要把程序能跑等同于策略有 edge。

## 当前策略是什么

`bitget-composite-router` 不是纯趋势交易。

它是一个混合路由：

- `BTCUSDT`：趋势突破分支，基于 Aberration volatility breakout。
- `XRPUSDT`：低吸反转分支，基于 VWAP pullback reclaim / Bollinger breakeven 的组合选择。
- 高抛分支：只作为 exit invalidation 平仓，不再允许开新空。

时间周期：

- `5m`：主执行和入场周期。
- `15m`：趋势确认。
- `1H`：结构背景。

成交量使用情况：

- 已使用：VWAP、volumeRatio、K 线推导的 taker flow / large trade / order book proxy。
- 问题：这些不是可靠的 Bitget 历史真实订单流。它们更像从 K 线派生出来的量能代理变量。
- 结论：现阶段不能把成交量部分当作真实 alpha 证据。

## 已完成资产

保留：

- Bitget native futures backtest 路径：`src/crypto/bitgetBacktest.ts`
- Bitget futures runner：`src/crypto/runBitgetFuturesBacktest.ts`
- futures 执行模型：`src/crypto/futuresBacktest.ts`
- exit-only sell 修复：高抛信号只平多，不开新空。
- `entryReason` 记录：回测交易能追溯分支来源。
- `bitget-composite-router` 测试：`src/crypto/strategies/bitgetCompositeRouter.test.ts`
- Bitget 长区间 chunk/retry：避免 1 年请求因为单次窗口太长失败。
- 分支归因思路：能看见是哪个 symbol / branch 在亏钱。

降级：

- `bitget-composite-router`：从 candidate 降级为研究样本。
- 90 天 branch gate：只能作为诊断材料，不能作为生产规则。
- 25x/30x full-margin 配置：只能作为压力测试，不可作为实盘模板。
- 30 天 50x/75x 漂亮结果：短窗样本，不可作为 readiness 证据。
- K 线推导的订单流 proxy：只能辅助观察，不能作为真实量能 edge。

## 回测证据

数据源：本地 `data/*.json` 报告。

| 窗口 | 文件 | 杠杆 | 保证金 | 持仓上限 | trades | return | maxDD | PF | winRate | 结论 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 30d | `data/bitget-composite-router-futures-30d-btc-xrp-5x-report.json` | 5x | 20U | 2 | 7 | +1.1564% | 0.7692% | 1.8716 | 71.43% | 样本太小 |
| 30d | `data/bitget-composite-router-futures-30d-btc-xrp-50x-report.json` | 50x | 20U | 2 | 7 | +11.6293% | 7.6921% | 1.8765 | 71.43% | 杠杆放大短窗 |
| 30d | `data/bitget-composite-router-futures-30d-btc-xrp-75x-report.json` | 75x | 20U | 2 | 7 | +17.4439% | 11.5382% | 1.8765 | 71.43% | 不能外推 |
| 90d | `data/bitget-composite-router-futures-90d-btc-xrp-5x-branchgate-report.json` | 5x | 20U | 2 | 12 | +1.3274% | 1.2186% | 1.7473 | 66.67% | 收益弱 |
| 90d | `data/bitget-composite-router-futures-90d-btc-xrp-20x-branchgate-report.json` | 20x | 20U | 2 | 12 | +5.3095% | 4.8744% | 1.7473 | 66.67% | 仍是短样本 |
| 90d | `data/bitget-composite-router-futures-90d-btc-xrp-25x-fullmargin-branchgate-report.json` | 25x | 100U | 1 | 12 | +34.2637% | 30.4339% | 1.7722 | 66.67% | 靠 full-margin 杠杆达到目标 |
| 90d | `data/bitget-composite-router-futures-90d-btc-xrp-30x-fullmargin-branchgate-report.json` | 30x | 100U | 1 | 12 | +41.1165% | 36.5207% | 1.7722 | 66.67% | 回撤不可接受 |
| 365d | `data/bitget-composite-router-futures-365d-btc-xrp-25x-fullmargin-branchgate-report.json` | 25x | 100U | 1 | 54 totals / 55 array | -232.4085% | 258.7426% | 0.5253 | 44.44% | 直接失败 |

365 天窗口：

- UTC：`2025-06-28T16:00:00.000Z` 到 `2026-06-28T16:00:00.000Z`
- 中国时间：`2025-06-29 00:00` 到 `2026-06-29 00:00`

365 天分 symbol：

| symbol | trades | pnl | PF | winRate |
|---|---:|---:|---:|---:|
| BTCUSDT | 16 | -82.9401U | 0.4156 | 37.50% |
| XRPUSDT | 39 | -169.3763U | 0.5391 | 46.15% |

365 天分 exit reason：

| exit | trades | pnl | PF | winRate |
|---|---:|---:|---:|---:|
| timeout | 15 | -64.7929U | 0.2301 | 33.33% |
| stop_loss | 16 | -334.9433U | 0 | 0% |
| take_profit | 19 | +237.7609U | infinite | 100% |
| signal_exit | 5 | -90.3411U | 0 | 0% |

## 失败原因

1. 90 天 branch gate 是用 90 天归因结果倒推出来的，扩展到 365 天失效。
2. 30 天漂亮结果来自 7 笔交易，样本量不够。
3. 周复利 2%-3% 的目标只有在 full-margin 高杠杆下接近，风险来源主要变成 leverage，不是 alpha。
4. 成交量是重要变量，但当前使用的是 K 线派生 proxy，不是真实 Bitget 历史成交主动性、持仓量、资金费率、多空结构。
5. timeout 和 signal_exit 都是负贡献，说明退出逻辑没有稳定截断坏交易。
6. 365 天两个核心分支都亏，说明不是单个币种偶然拖累。

## 保留和删除

不立刻物理删除代码。先逻辑隔离。

保留为基础设施：

- Bitget 数据下载、chunk、retry、K 线转换。
- futures backtest 执行器。
- trade attribution。
- strategy registry。
- rawScore / blocked 输出格式。
- exit-only sell 语义。

标记为不可交易：

- `bitget-composite-router`
- `range-filter` / `range-frama` 这类 30 天弱证据策略
- 所有 `50x+` 靠短窗收益吸引人的配置

下一次如果要删代码，先开独立清理任务，不在策略研究时顺手删除。

## 重启路线

只走一条线：Bitget 真实量能研究层。

第一阶段：数据证据

- 拉真实 Bitget futures 数据，不用 Binance 替代。
- 至少覆盖：5m/15m/1H K 线、真实 volume、open interest、funding rate、long/short ratio。
- 如果历史主动买卖、逐笔成交、盘口深度没有可靠历史接口，就明确写 `blocked=data_missing`，不能用 proxy 冒充。

第二阶段：特征研究

- 只研究有市场含义的变量：
  - 放量突破后是否有延续。
  - 回调时是否缩量。
  - OI 增加时价格方向是否同步。
  - funding 极端时是否有反身性风险。
  - 多空比拥挤时是否容易反向。
  - VWAP 附近成交集中后是否出现可交易偏移。

第三阶段：验证

- 先做 1 年研究扫描。
- 再做 walk-forward。
- 再做 2-4 周 paper。
- paper 前状态最多 `observe_only`。
- 没有 paper 证据，不允许进入 `sim_ready`。

第四阶段：升级门槛

最低升级条件：

- 1 年样本不亏穿。
- walk-forward 不崩。
- 交易数足够，不靠 10 几笔解释全年。
- 手续费、滑点、价差、资金费率全部计入。
- maxDD 在预设范围内。
- 退出逻辑不是主要亏损来源。
- `blocked=...` 能解释大多数 hold，而不是沉默。

实盘门槛：

- 必须用户明确确认。
- 先小仓低杠杆。
- 默认不超过 2x-5x。
- 不允许从 25x/30x full-margin 直接上线。

## 当前正确动作

停止做这些：

- 不再为了每周 2%-3% 去拧杠杆。
- 不再在当前 router 上继续加条件。
- 不再用 30 天或 90 天结果证明策略。
- 不再把 proxy volume 当真实订单流。

开始做这些：

- 把现有策略状态固定为 `no_trade`。
- 用 Bitget 真实市场数据重建研究层。
- 先做证据，再谈策略。
- 每次新策略必须回答：赚什么钱、对手是谁、收益来自 alpha 还是 leverage、什么行情会失效。

## 成本止损

这两个月不是产出一个能交易的策略。

能保留下来的成果是：

- 一个 Bitget 回测基础设施。
- 一批失败样本。
- 一个明确结论：当前方向不能继续调参。
- 一个新边界：没有真实量能证据，不再谈上线。

这就是止损点。
