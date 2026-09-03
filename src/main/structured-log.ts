/* =========================================================================
   结构化事件日志(JSON Lines,可观测性增强 roadmap §3.1)。

   electron-log 保留人类可读文本日志(排障用);本模块把关键事件以 JSON
   Lines 追加到 userData/logs/events.jsonl,供 Settings 内嵌日志查看器
   过滤/搜索。超过行数/字节上限自动截断,避免无限增长。

   路径注入:默认走 app.getPath("userData");node 环境单测可
   setStructuredLogDir(tmpdir) 后完整测试 append/read(不依赖 electron)。
   ========================================================================= */

import { join } from "node:path"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { app } from "electron"
import type { StructuredEvent } from "../shared/structured-log"

export const STRUCTURED_LOG_MAX_LINES = 2_000
export const STRUCTURED_LOG_MAX_BYTES = 512 * 1024 // 512KB,超限重写保留最近部分

/** 测试注入:覆盖 userData 目录;null 恢复默认(app.getPath)。 */
let baseDir: string | null = null
export function setStructuredLogDir(dir: string | null): void {
  baseDir = dir
}

function resolveLogPath(): string {
  return join(baseDir ?? app.getPath("userData"), "logs", "events.jsonl")
}

/** 格式化一行 JSON Lines(纯函数,可单测)。 */
export function formatEventLine(e: StructuredEvent): string {
  return JSON.stringify(e)
}

/** 解析一行 JSON Lines;损坏/空行返回 null(纯函数,可单测)。 */
export function parseEventLine(line: string): StructuredEvent | null {
  if (!line.trim()) return null
  try {
    const parsed = JSON.parse(line) as StructuredEvent
    if (typeof parsed.ts !== "number" || typeof parsed.msg !== "string") return null
    if (parsed.level !== "info" && parsed.level !== "warn" && parsed.level !== "error") {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** 截断文件:行数或字节超限时保留最近部分(失败静默,不打断主流程)。 */
function trimFile(path: string): void {
  try {
    if (statSync(path).size <= STRUCTURED_LOG_MAX_BYTES) return
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean)
    if (lines.length > STRUCTURED_LOG_MAX_LINES) {
      writeFileSync(path, lines.slice(-STRUCTURED_LOG_MAX_LINES).join("\n") + "\n")
    }
  } catch {
    /* ignore */
  }
}

/** 追加一条事件;写入失败静默(日志不能影响主流程)。 */
export function appendEvent(
  level: StructuredEvent["level"],
  msg: string,
  props?: Record<string, unknown>,
): void {
  const path = resolveLogPath()
  const line = formatEventLine({ ts: Date.now(), level, msg, ...props })
  try {
    if (!existsSync(path)) {
      mkdirSync(join(path, ".."), { recursive: true })
      writeFileSync(path, line + "\n")
      return
    }
    appendFileSync(path, line + "\n")
    trimFile(path)
  } catch {
    /* ignore */
  }
}

/** 读取最近 limit 条事件(新 → 旧)。 */
export function readStructuredEvents(limit = 200): StructuredEvent[] {
  const path = resolveLogPath()
  try {
    if (!existsSync(path)) return []
    const events: StructuredEvent[] = []
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const e = parseEventLine(line)
      if (e) events.push(e)
    }
    return events.slice(-limit).reverse()
  } catch {
    return []
  }
}
