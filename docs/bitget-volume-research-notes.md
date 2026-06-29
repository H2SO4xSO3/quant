# Bitget Volume Research Notes

## Current State

```text
action=hold
rawScore=0
state=no_trade
blocked=blocked=data_missing featureCoveragePct=1.53
evidence=Bitget public market-context collection works for BTCUSDT/XRPUSDT, but rows do not span the requested 365d window.
next_check=build a persistent collector before any walk-forward feature study.
```

## Data Boundary

This research layer is Bitget-native.

Use real Bitget futures market context:

- USDT-FUTURES candles
- current open interest
- history funding rate
- taker buy/sell volume
- long/short ratio
- account long/short ratio
- position long/short ratio

Do not treat K-line-derived proxy flow as true order flow.

If a historical field is unavailable, report:

```text
state=no_trade
blocked=blocked=data_missing field=...
```

## Official Endpoint Families

- Contract market: open interest and historical funding.
- Trading insights: taker buy/sell volume, long/short ratio, account long/short ratio, position long/short ratio.

## Latest Local Run

- Path: `data/bitget-volume-research-365d.json`
- Symbols: `BTCUSDT`, `XRPUSDT`
- Period: `5m`
- Funding rows: `100` per symbol
- Trading insight rows: `30` per symbol for taker buy/sell and long/short data
- Feature time coverage over 365 days: `1.53%`
- State: `no_trade`

Current data boundary:

- Open interest is current-only in this collector.
- Funding uses historical rows, currently one page.
- Trading insights return short period windows, not a full 365d dataset.

## Persistent Collector

Run once:

```powershell
npm.cmd run bitget-volume-collect -- --symbols BTCUSDT,XRPUSDT --period 5m --data-dir data/bitget-volume-history
```

Current collector output:

- `data/bitget-volume-history/market-contexts.jsonl`
- `data/bitget-volume-history/collector-summaries.jsonl`

Latest collector summary:

```text
timestampReceived=2026-06-29T14:11:32.541Z
symbols=2
contexts=2
blockers=0
errors=0
```

Latest per-symbol rows:

| symbol | period | fundingRows | takerRows | longShortRows | blockers |
|---|---|---:|---:|---:|---:|
| BTCUSDT | 5m | 100 | 30 | 30 | 0 |
| XRPUSDT | 5m | 100 | 30 | 30 | 0 |

Interpretation:

- This is data collection only.
- State remains `no_trade`.
- The first persistent sample does not prove edge.
- Research starts only after the JSONL history spans enough time.

## Upgrade Rule

Research can move only this way:

```text
no_trade -> observe_only -> paper -> sim_ready
```

No direct jump from backtest to live.

Minimum gates:

- 1-year feature coverage >= 80%
- positive expectancy after fees/slippage/funding assumptions
- profit factor >= 1.15
- trades >= 80
- max drawdown <= 20%
- walk-forward pass rate >= 60%
- 2-4 weeks paper evidence before `sim_ready`

25x+ full-margin results are not readiness evidence.
