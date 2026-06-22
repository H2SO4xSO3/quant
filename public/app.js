const $ = (id) => document.getElementById(id);
const buttons = Array.from(document.querySelectorAll("button"));

function fmt(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-";
}

function time(value) {
  return value ? new Date(value).toLocaleString("zh-CN") : "-";
}

function setBusy(busy) {
  for (const button of buttons) {
    button.disabled = busy;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function renderPositions(positions) {
  const root = $("positions");
  if (!positions.length) {
    root.className = "list empty";
    root.textContent = "暂无持仓";
    return;
  }

  root.className = "list";
  root.innerHTML = positions
    .map(
      (entry) => `
        <div class="item">
          <strong>${entry.symbol}</strong>
          <span>数量 ${entry.quantity ?? "-"}</span>
          <span>止损 ${fmt(entry.stopLoss, 6)}</span>
          <span>止盈 ${fmt(entry.takeProfit, 6)}</span>
        </div>
      `
    )
    .join("");
}

function renderBacktest(report) {
  const root = $("backtest");
  if (!report?.current) {
    root.className = "list empty";
    root.textContent = "暂无回测报告";
    return;
  }

  const current = report.current.totals;
  const guarded = report.guarded?.totals;
  const best = report.optimized?.best;
  const capital = report.current.initialCapitalUsdt ?? 0;
  root.className = "list";
  root.innerHTML = `
    <div class="item">
      <strong>当前参数</strong>
      <span>交易 ${current.trades}</span>
      <span class="${current.netPnlUsdt >= 0 ? "up" : "down"}">PnL ${fmt(current.netPnlUsdt, 4)}U</span>
      <span>收益率 ${fmt(current.returnPct, 3)}%</span>
    </div>
    <div class="item">
      <strong>组合风控</strong>
      <span>本金 ${fmt(capital, 0)}U</span>
      <span>回撤 ${fmt(current.maxDrawdownPct, 3)}%</span>
      <span>占用 ${fmt(current.capitalUtilizationPct, 1)}%</span>
    </div>
    ${
      guarded
        ? `<div class="item">
            <strong>闸门后组合</strong>
            <span>交易 ${guarded.trades}</span>
            <span class="${guarded.netPnlUsdt >= 0 ? "up" : "down"}">PnL ${fmt(guarded.netPnlUsdt, 4)}U</span>
            <span>收益率 ${fmt(guarded.returnPct, 3)}%</span>
          </div>`
        : ""
    }
    ${
      best
        ? `<div class="item">
            <strong>候选最优</strong>
            <span>score ${best.strategy.minBuyScore}</span>
            <span>ATR ${best.strategy.atrStopMultiplier}</span>
            <span>TP ${best.strategy.takeProfitRiskMultiple}</span>
          </div>`
        : ""
    }
  `;
}

function renderEvents(events) {
  $("eventCount").textContent = `${events.length} 条`;
  $("events").innerHTML = events
    .map(
      (event) => `
        <tr>
          <td>${time(event.timestamp)}</td>
          <td>${event.type}</td>
          <td>${event.symbol ?? "-"}</td>
          <td>${event.price ? fmt(event.price, 6) : "-"}</td>
          <td>${event.quantity ?? "-"}</td>
          <td>${event.message}</td>
        </tr>
      `
    )
    .join("");
}

function render(state) {
  $("updatedAt").textContent = time(state.generatedAt);
  $("liveTrading").textContent = state.config.liveTrading ? "LIVE" : "关闭";
  $("exitTrading").textContent = state.config.exitLiveTrading ? "LIVE" : "关闭";
  $("aiReview").textContent = state.config.aiReview?.enabled ? state.config.aiReview.model : "关闭";
  $("aiKey").textContent = state.config.aiReview?.configured ? "已配置" : "未配置";
  $("backtestGuard").textContent = state.config.backtestGuard?.enabled ? "开启" : "关闭";
  $("backtestCapital").textContent = `${state.config.backtestInitialCapitalUsdt}U`;
  $("maxOrder").textContent = `${state.config.maxOrderUsdt}U`;
  $("maxPositions").textContent = state.config.maxOpenPositions;
  $("maxLoss").textContent = `${state.config.maxPositionLossUsdt}U`;
  $("buyLoop").textContent = state.loops.buyRunning ? "运行中" : "停止";
  $("exitLoop").textContent = state.loops.exitRunning ? "运行中" : "停止";
  $("symbols").textContent = state.config.symbols.join(" / ");
  $("strategyBrief").textContent =
    `score ${state.config.minBuyScore} / VWAP ${state.config.strategy.minPriceVwapPct}-${state.config.strategy.maxPriceVwapPct}% / 冷却 ${state.config.strategy.entryCooldownMinutes}m`;
  renderPositions(state.openPositions);
  renderBacktest(state.backtest);
  renderEvents(state.events);
}

async function refresh() {
  render(await request("/api/status"));
}

async function action(path) {
  try {
    setBusy(true);
    await request(path, { method: "POST" });
    await refresh();
  } catch (error) {
    alert(error.message);
  } finally {
    setBusy(false);
  }
}

$("refreshBtn").addEventListener("click", () => void refresh());
$("scanOnceBtn").addEventListener("click", () => void action("/api/scan-once"));
$("exitOnceBtn").addEventListener("click", () => void action("/api/exit-once"));
$("startExitBtn").addEventListener("click", () => void action("/api/exit-loop/start"));
$("stopExitBtn").addEventListener("click", () => void action("/api/exit-loop/stop"));
$("startBuyBtn").addEventListener("click", () => void action("/api/buy-loop/start"));
$("stopBuyBtn").addEventListener("click", () => void action("/api/buy-loop/stop"));

void refresh();
setInterval(() => void refresh(), 5000);
