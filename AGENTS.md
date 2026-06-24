# Project Boundary

This workspace is only for the Binance spot quant bot.

- Work on crypto strategy, Binance data/trading APIs, dashboard controls, risk rules, logs, and backtests here.
- Do not inspect or modify the A-share selector workspace unless the user explicitly asks for cross-project work.
- Keep local secrets in `.env` and do not print them in chat or logs.
- Main entry point: `Start-Quant-Dashboard.cmd`.

## Quant Knowledge Kernel

Before designing strategies, reviewing backtests, changing risk rules, or judging paper/live readiness, read:

`C:\Users\h2so4\Documents\Obsidian Vault\Codex\量化知识内核\01-量化项目指令-v2.md`

Use that file as the project-level quant research posture:

- preserve `rawScore`
- emit explicit `blocked=...`
- separate infrastructure health from strategy readiness
- distinguish alpha, beta, risk premium, liquidity, volatility, and leverage
- treat backtests as biased evidence, not proof
- use hard states such as `observe_only`, `sim_ready`, and `no_trade`
