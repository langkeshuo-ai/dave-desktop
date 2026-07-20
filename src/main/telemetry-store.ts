/* =========================================================================
   主进程端 telemetry store —— 事件落 electron-store,环形缓冲 5000 条。
   ========================================================================= */

import { getStore } from "./store"
import {
  computeFunnel,
  TELEMETRY_MAX_EVENTS,
  type FunnelSnapshot,
  type TelemetryEvent,
  type TelemetryEventName,
} from "../shared/telemetry"

const STORE_KEY = "telemetry-events"

/** 读取全部事件(只读,调用方不要修改返回数组)。 */
export function readEvents(): TelemetryEvent[] {
  return (getStore().get(STORE_KEY) as TelemetryEvent[] | undefined) ?? []
}

/** 推入一条事件。环形缓冲:超过上限丢最旧。 */
export function trackEvent(name: TelemetryEventName, props?: Record<string, string>): void {
  const events = readEvents()
  const ev: TelemetryEvent = { name, ts: Date.now(), props }
  events.push(ev)
  if (events.length > TELEMETRY_MAX_EVENTS) {
    events.splice(0, events.length - TELEMETRY_MAX_EVENTS)
  }
  getStore().set(STORE_KEY, events)
}

/** 清空所有事件(供用户在设置里手动重置统计用)。 */
export function clearEvents(): void {
  getStore().set(STORE_KEY, [])
}

/** 取漏斗快照。 */
export function getFunnelSnapshot(): FunnelSnapshot {
  return computeFunnel(readEvents())
}

/** 是否首启(electron-store 中没有 onboarding_completed 记录)。 */
export function isFirstRun(): boolean {
  return !readEvents().some((e) => e.name === "onboarding_completed")
}
