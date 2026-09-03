/* =========================================================================
   渲染端 telemetry 助手 —— 通过 IPC 转发到主进程 store。
   失败静默:遥测不该影响业务路径,吞错返回即可。
   ========================================================================= */

import type { TelemetryEventName } from "../../shared/telemetry"

export function track(name: TelemetryEventName, props?: Record<string, string>): void {
  // 不 await:遥测是 fire-and-forget,不让等待影响 UI 响应。
  // IPC 失败时静默,避免污染 console。
  void window.dave.telemetry.emit(name, props).catch(() => {
    /* 静默 */
  })
}
