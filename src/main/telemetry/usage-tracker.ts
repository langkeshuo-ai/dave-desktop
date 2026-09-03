/**
 * Usage Tracker — 本地使用统计
 *
 * 从 zcode-client 的 usage.mjs 设计迁移，TypeScript 实现。
 * 记录本地使用数据（不上传任何第三方），用于用户自我量化和产品改进。
 *
 * 统计维度：
 * 1. 模型调用次数 + Token 消耗（prompt/completion/total）
 * 2. 工具使用频率（按工具名统计）
 * 3. 会话统计（创建数、消息数、平均长度）
 * 4. 时间分布（按小时/天/周）
 * 5. Provider 使用分布
 *
 * 数据存储：~/.dave/client/usage/ 目录下的 JSON 文件，按日期分文件。
 */
import fs from "node:fs"
import path from "node:path"
import { clientDataRoot, ensureDir } from "../utils/paths"

// ─── 类型 ────────────────────────────────────────────────

export interface ModelUsage {
  calls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
}

export interface ToolUsage {
  count: number
  lastUsed: number
}

export interface SessionUsage {
  created: number
  messages: number
  avgMessageLength: number
}

export interface DailyUsage {
  date: string // YYYY-MM-DD
  models: Record<string, ModelUsage>
  tools: Record<string, ToolUsage>
  sessions: SessionUsage
  providers: Record<string, number>
  firstActivity: number
  lastActivity: number
}

export interface UsageSummary {
  totalCalls: number
  totalTokens: number
  totalCostUsd: number
  totalSessions: number
  totalMessages: number
  topModels: Array<{ model: string; calls: number; tokens: number }>
  topTools: Array<{ tool: string; count: number }>
  dateRange: { start: string; end: string }
  daysTracked: number
}

export interface TrackModelCallOptions {
  model: string
  provider?: string
  promptTokens?: number
  completionTokens?: number
  costUsd?: number
}

export interface TrackToolUseOptions {
  tool: string
  sessionId?: string
}

// ─── 路径工具 ────────────────────────────────────────────

function usageDir(): string {
  return ensureDir(path.join(clientDataRoot(), "usage"))
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function usageFile(date: string): string {
  return path.join(usageDir(), `${date}.json`)
}

// ─── 读写 ─────────────────────────────────────────────────

function readDaily(date: string): DailyUsage {
  const file = usageFile(date)
  if (!fs.existsSync(file)) {
    return createEmptyDaily(date)
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as DailyUsage
  } catch {
    return createEmptyDaily(date)
  }
}

function writeDaily(date: string, data: DailyUsage): void {
  const file = usageFile(date)
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8")
}

function createEmptyDaily(date: string): DailyUsage {
  const now = Date.now()
  return {
    date,
    models: {},
    tools: {},
    sessions: { created: 0, messages: 0, avgMessageLength: 0 },
    providers: {},
    firstActivity: now,
    lastActivity: now,
  }
}

function updateActivity(data: DailyUsage): void {
  const now = Date.now()
  if (!data.firstActivity) data.firstActivity = now
  data.lastActivity = now
}

// ─── 核心 API ─────────────────────────────────────────────

/**
 * 记录一次模型调用。
 * 累加调用次数、Token 消耗、费用。
 */
export function trackModelCall(options: TrackModelCallOptions): void {
  const date = todayStr()
  const data = readDaily(date)
  updateActivity(data)

  const model = options.model || "unknown"
  const existing = data.models[model] || {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  }

  existing.calls += 1
  existing.promptTokens += options.promptTokens || 0
  existing.completionTokens += options.completionTokens || 0
  existing.totalTokens += (options.promptTokens || 0) + (options.completionTokens || 0)
  existing.costUsd += options.costUsd || 0

  data.models[model] = existing

  if (options.provider) {
    data.providers[options.provider] = (data.providers[options.provider] || 0) + 1
  }

  writeDaily(date, data)
}

/**
 * 记录一次工具使用。
 */
export function trackToolUse(options: TrackToolUseOptions): void {
  const date = todayStr()
  const data = readDaily(date)
  updateActivity(data)

  const tool = options.tool || "unknown"
  const existing = data.tools[tool] || { count: 0, lastUsed: 0 }
  existing.count += 1
  existing.lastUsed = Date.now()
  data.tools[tool] = existing

  writeDaily(date, data)
}

/**
 * 记录会话创建。
 */
export function trackSessionCreated(): void {
  const date = todayStr()
  const data = readDaily(date)
  updateActivity(data)
  data.sessions.created += 1
  writeDaily(date, data)
}

/**
 * 记录一条消息（用于统计消息数和平均长度）。
 */
export function trackMessage(messageLength: number): void {
  const date = todayStr()
  const data = readDaily(date)
  updateActivity(data)

  const prevTotal = data.sessions.avgMessageLength * data.sessions.messages
  data.sessions.messages += 1
  data.sessions.avgMessageLength = (prevTotal + messageLength) / data.sessions.messages

  writeDaily(date, data)
}

/**
 * 获取指定日期的使用统计。
 */
export function getDailyUsage(date: string): DailyUsage {
  return readDaily(date)
}

/**
 * 获取今天的使用统计。
 */
export function getTodayUsage(): DailyUsage {
  return readDaily(todayStr())
}

/**
 * 获取日期范围内的使用统计汇总。
 * @param startDate 起始日期（YYYY-MM-DD），默认7天前
 * @param endDate 结束日期（YYYY-MM-DD），默认今天
 */
export function getUsageSummary(startDate?: string, endDate?: string): UsageSummary {
  const end = endDate ? new Date(endDate) : new Date()
  const start = startDate ? new Date(startDate) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)

  const modelTotals = new Map<string, { calls: number; tokens: number }>()
  const toolTotals = new Map<string, number>()
  let totalCalls = 0
  let totalTokens = 0
  let totalCostUsd = 0
  let totalSessions = 0
  let totalMessages = 0
  let daysTracked = 0
  let earliest = end.toISOString().slice(0, 10)
  let latest = start.toISOString().slice(0, 10)

  const current = new Date(start)
  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10)
    const data = readDaily(dateStr)

    if (data.models && Object.keys(data.models).length > 0) {
      daysTracked++
      if (dateStr < earliest) earliest = dateStr
      if (dateStr > latest) latest = dateStr
    }

    for (const [model, usage] of Object.entries(data.models || {})) {
      totalCalls += usage.calls
      totalTokens += usage.totalTokens
      totalCostUsd += usage.costUsd
      const existing = modelTotals.get(model) || { calls: 0, tokens: 0 }
      existing.calls += usage.calls
      existing.tokens += usage.totalTokens
      modelTotals.set(model, existing)
    }

    for (const [tool, usage] of Object.entries(data.tools || {})) {
      const existing = toolTotals.get(tool) || 0
      toolTotals.set(tool, existing + usage.count)
    }

    totalSessions += data.sessions?.created || 0
    totalMessages += data.sessions?.messages || 0

    current.setDate(current.getDate() + 1)
  }

  const topModels = [...modelTotals.entries()]
    .map(([model, stats]) => ({ model, ...stats }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 10)

  const topTools = [...toolTotals.entries()]
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return {
    totalCalls,
    totalTokens,
    totalCostUsd,
    totalSessions,
    totalMessages,
    topModels,
    topTools,
    dateRange: { start: earliest, end: latest },
    daysTracked,
  }
}

/**
 * 导出使用统计为 JSON（用于用户备份或导入）。
 */
export function exportUsage(startDate?: string, endDate?: string): string {
  const summary = getUsageSummary(startDate, endDate)
  return JSON.stringify(summary, null, 2)
}

/**
 * 清除指定日期之前的使用数据（用于隐私保护）。
 */
export function purgeUsageBefore(beforeDate: string): number {
  const dir = usageDir()
  if (!fs.existsSync(dir)) return 0

  let purged = 0
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue
    const dateStr = file.replace(".json", "")
    if (dateStr < beforeDate) {
      try {
        fs.rmSync(path.join(dir, file), { force: true })
        purged++
      } catch {
        // skip
      }
    }
  }
  return purged
}
