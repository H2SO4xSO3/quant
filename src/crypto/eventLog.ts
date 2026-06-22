import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type TradeEventType = "scan" | "buy" | "sell_check" | "sell" | "risk_block" | "backtest" | "error" | "system";

export interface TradeEvent {
  id?: string;
  timestamp: string;
  type: TradeEventType;
  symbol?: string;
  message: string;
  score?: number;
  price?: number;
  quantity?: number;
  quoteQty?: number;
  realizedPnlUsdt?: number;
  details?: unknown;
}

export interface TradeEventState {
  events: TradeEvent[];
}

export class TradeEventLog {
  constructor(private readonly filePath: string) {}

  read(): TradeEventState {
    if (!existsSync(this.filePath)) {
      return { events: [] };
    }

    try {
      return JSON.parse(readFileSync(this.filePath, "utf8")) as TradeEventState;
    } catch {
      return { events: [] };
    }
  }

  append(event: Omit<TradeEvent, "id" | "timestamp"> & Partial<Pick<TradeEvent, "id" | "timestamp">>): TradeEvent {
    const state = this.read();
    const next: TradeEvent = {
      ...event,
      id: event.id ?? `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: event.timestamp ?? new Date().toISOString()
    };
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify({ events: [next, ...state.events].slice(0, 2000) }, null, 2)}\n`, "utf8");
    return next;
  }
}
