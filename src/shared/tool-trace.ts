/**
 * Tool trace — 工具执行轨迹的纯函数聚合逻辑（渲染端 A2' 执行可视化）
 *
 * 主进程把每次工具调用结果落库为 role:"tool" 消息（content 为 clamp 后的输出）。
 * 渲染端在流结束后补拉会话历史，从 tool 消息中提取"执行轨迹"渲染为汇总卡。
 * 状态由 content 前缀推导（主进程写入形态固定，见 chat-loop.ts runToolCalls）：
 *   - "用户拒绝了此操作…"            → denied
 *   - "工具失败：…" / "错误：未知工具…" → failed
 *   - 其余                             → ok
 * 纯 TS、无副作用、无 Electron 依赖，node 环境可单测。
 */

export type ToolTraceStatus = "ok" | "denied" | "failed"

export interface ToolTrace {
  /** 工具名（role:"tool" 消息的 name） */
  name: string
  /** 工具输出 content（主进程已 clampToolOutput） */
  content: string
  /** 导出状态（由 content 推导） */
  status: ToolTraceStatus
}

/** 单条 tool 轨迹的去重键（name + content；同工具同输出的重复推送按幂等忽略） */
export function toolTraceKey(trace: { name?: string; content: string }): string {
  return `${trace.name || "tool"}::${trace.content}`
}

/** 从 tool 消息 content 推导展示状态（前缀匹配主导进程的固定写入形态） */
export function toToolTraceStatus(content: string): ToolTraceStatus {
  if (content.startsWith("用户拒绝")) return "denied"
  if (content.startsWith("工具失败") || content.startsWith("错误：")) return "failed"
  return "ok"
}

/**
 * 把 role:"tool" 消息数组转换为 ToolTrace 列表：
 * 按 (name, content) 幂等去重（保留首次顺序），截断到 load 上限。
 */
export function toToolTraces(
  toolMessages: ReadonlyArray<{ name?: string; content: string }>,
  max = 8,
): ToolTrace[] {
  const seen = new Set<string>()
  const traces: ToolTrace[] = []
  for (const m of toolMessages) {
    const name = m.name || "tool"
    const key = `${name}::${m.content}`
    if (seen.has(key)) continue
    seen.add(key)
    traces.push({ name, content: m.content, status: toToolTraceStatus(m.content) })
    if (traces.length >= max) break
  }
  return traces
}
