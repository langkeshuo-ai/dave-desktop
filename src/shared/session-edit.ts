/**
 * 会话编辑/再生成 — 纯函数，无 Electron 依赖，可单测。
 *
 * 编辑用户消息：丢弃该条及之后全部消息，再以新内容重新发起一轮。
 * 再生成：丢弃末条 user 之后的 assistant/tool，保留此前上下文，再发同一 user 内容。
 */

import type { ChatMessage } from "./types"

/** 编辑第 userIndex 条 user 消息前应保留的前缀（不含该条）。 */
export function messagesBeforeUserEdit(
  messages: readonly ChatMessage[],
  userIndex: number,
): ChatMessage[] | null {
  if (!Number.isInteger(userIndex) || userIndex < 0 || userIndex >= messages.length) {
    return null
  }
  if (messages[userIndex]?.role !== "user") return null
  return messages.slice(0, userIndex).map((m) => ({ ...m }))
}

/** 再生成：定位末条 user，返回其内容与应保留前缀。 */
export function planRegenerate(messages: readonly ChatMessage[]): {
  prefix: ChatMessage[]
  userContent: string
  userIndex: number
} | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role === "user") {
      return {
        prefix: messages.slice(0, i).map((x) => ({ ...x })),
        userContent: m.content || "",
        userIndex: i,
      }
    }
  }
  return null
}

/** 校验可持久化的消息列表（防 IPC 注入畸形结构）。 */
export function sanitizeMessagesForReplace(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input)) return null
  if (input.length > 5_000) return null
  const out: ChatMessage[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null
    const m = raw as Record<string, unknown>
    const role = m.role
    if (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool") {
      return null
    }
    if (typeof m.content !== "string") return null
    if (m.content.length > 500_000) return null
    const msg: ChatMessage = { role, content: m.content }
    if (typeof m.name === "string" && m.name.length <= 128) msg.name = m.name
    if (typeof m.tool_call_id === "string" && m.tool_call_id.length <= 128) {
      msg.tool_call_id = m.tool_call_id
    }
    // tool_calls 结构复杂；编辑截断场景通常不含，忽略以降低攻击面
    out.push(msg)
  }
  return out
}
