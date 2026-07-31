/* =========================================================================
   日志级别(shared)——electron-log 输出级别白名单,main 启动/IPC 与
   Settings 选择器共用;node 环境可单测。
   ========================================================================= */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** 校验日志级别;合法返回 true(类型收窄为 LogLevel)。 */
export function isValidLogLevel(v: unknown): v is LogLevel {
  return typeof v === "string" && (LOG_LEVELS as readonly string[]).includes(v)
}
