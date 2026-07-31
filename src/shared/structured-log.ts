/* =========================================================================
   结构化事件日志类型(shared)——main 写入、preload 透传、renderer 展示共用。
   实现见 src/main/structured-log.ts(JSON Lines 落盘 + 截断)。
   ========================================================================= */

export interface StructuredEvent {
  ts: number
  level: "info" | "warn" | "error"
  msg: string
  [key: string]: unknown
}
