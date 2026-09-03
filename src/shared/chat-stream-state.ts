/**
 * Chat Stream State Machine — 纯函数状态机
 *
 * 管理流式聊天事件的有限状态机。
 * 无副作用，无 Electron 依赖，可在 vitest node 环境单测。
 *
 * 状态转移矩阵：
 *           idle → start → streaming
 *    streaming → chunk → streaming
 *    streaming → done → done
 *    streaming → error → error
 *    streaming → tools → tool_pending
 *    streaming → approval → approval_pending
 *    streaming → patch → streaming
 *    streaming → start → streaming (reset content)
 *  tool_pending → chunk → streaming
 *  tool_pending → error → error
 *  tool_pending → start → streaming (reset)
 *  approval_pending → approval_result → streaming
 *  approval_pending → error → error
 *  approval_pending → start → streaming (reset)
 *           done → reset → idle
 *           done → start → streaming
 *          error → reset → idle
 *          error → start → streaming
 *           any → reset → idle
 */
import type {
  ChatStreamChunk,
  ChatStreamDone,
  ChatStreamError,
  ChatStreamApproval,
  ChatStreamPatch,
  ChatStreamTools,
} from "./types"

// ─── 事件类型 ───────────────────────────────────────

export type StreamEvent =
  | { type: "start"; sessionId: string }
  | ({ type: "chunk" } & ChatStreamChunk & { idempotentKey?: string })
  | ({ type: "done" } & ChatStreamDone)
  | ({ type: "error" } & ChatStreamError)
  | ({ type: "tools" } & ChatStreamTools)
  | ({ type: "approval" } & ChatStreamApproval)
  | ({ type: "patch" } & ChatStreamPatch)
  | { type: "approval_result"; sessionId: string; approved: boolean }
  | { type: "reset" }

// ─── 状态类型 ───────────────────────────────────────

export type StreamStateStatus =
  | { status: "idle" }
  | { status: "streaming"; content: string; sessionId: string }
  | { status: "tool_pending"; content: string; sessionId: string; tools: string[] }
  | {
      status: "approval_pending"
      content: string
      sessionId: string
      tool: string
      toolArgs: Record<string, unknown>
      mutates: boolean
      isShell: boolean
    }
  | { status: "done"; sessionId: string; aborted?: boolean; finalContent: string }
  | { status: "error"; error: string; sessionId: string }

// ─── 状态机接口 ─────────────────────────────────────

export interface ChatStreamState {
  /** 获取当前状态 */
  getState: () => StreamStateStatus
  /** 应用事件并返回自身（支持链式调用） */
  transition: (event: StreamEvent) => ChatStreamState
}

// ─── 幂等 key 去重（会话维度命名空间化） ─────────────

const processedKeys = new Set<string>()

/** 重置幂等 key 缓存（测试用 / 会话切换时） */
export function resetIdempotentKeys(): void {
  processedKeys.clear()
}

/** 清空指定会话的幂等 key */
function clearSessionKeys(sessionId: string): void {
  const prefix = `${sessionId}:`
  for (const key of processedKeys) {
    if (key.startsWith(prefix)) {
      processedKeys.delete(key)
    }
  }
}

/** 以会话 + idempotentKey 拼出命名空间化 key，避免跨会话误杀 */
function namespacedKey(sessionId: string, idempotentKey: string): string {
  return `${sessionId}:${idempotentKey}`
}

// ─── 状态机实现 ─────────────────────────────────────

function transitionState(state: StreamStateStatus, event: StreamEvent): StreamStateStatus {
  // 幂等 key 检查（按会话命名空间化）
  if ("idempotentKey" in event && event.idempotentKey) {
    const key = namespacedKey(event.sessionId, event.idempotentKey)
    if (processedKeys.has(key)) {
      return state // 已处理，跳过
    }
    processedKeys.add(key)
  }

  // reset 事件：从任何状态回到 idle，并清空幂等集合（允许重放）
  if (event.type === "reset") {
    resetIdempotentKeys()
    return { status: "idle" }
  }

  // start 事件：从任何非 idle 状态重新开始，并清空该会话幂等集合（断线重连允许同 key 重放）
  if (event.type === "start") {
    clearSessionKeys(event.sessionId)
    return { status: "streaming", content: "", sessionId: event.sessionId }
  }

  // done / error 到达即终态：该会话 chunk 幂等 key 不再需要，立即清理防无界增长
  if (event.type === "done" || event.type === "error") {
    clearSessionKeys(event.sessionId)
  }

  switch (state.status) {
    case "idle":
      // idle 只接受 start（已处理）和 reset（已处理）
      return state

    case "streaming": {
      switch (event.type) {
        case "chunk":
          if (event.replace) {
            return { status: "streaming", content: event.content, sessionId: event.sessionId }
          }
          return {
            status: "streaming",
            content: state.content + event.content,
            sessionId: event.sessionId,
          }
        case "done":
          return {
            status: "done",
            sessionId: event.sessionId,
            aborted: event.aborted,
            finalContent: state.content,
          }
        case "error":
          return { status: "error", error: event.error, sessionId: event.sessionId }
        case "tools":
          return {
            status: "tool_pending",
            content: state.content,
            sessionId: event.sessionId,
            tools: event.tools,
          }
        case "approval":
          return {
            status: "approval_pending",
            content: state.content,
            sessionId: event.sessionId,
            tool: event.tool,
            toolArgs: event.arguments,
            mutates: event.mutates,
            isShell: event.isShell,
          }
        case "patch":
          // patch（diff）是独立载体，不写入正文流：正文保持，后续 chunk 正常累加
          return { status: "streaming", content: state.content, sessionId: event.sessionId }
        default:
          return state
      }
    }

    case "tool_pending": {
      switch (event.type) {
        case "chunk":
          // 工具完成后恢复 streaming，累加新 content
          return {
            status: "streaming",
            content: state.content + event.content,
            sessionId: event.sessionId,
          }
        case "approval":
          // 工具执行中请求下一项审批（mock 与真实 agent 工具轮均出现）
          return {
            status: "approval_pending",
            content: state.content,
            sessionId: event.sessionId,
            tool: event.tool,
            toolArgs: event.arguments,
            mutates: event.mutates,
            isShell: event.isShell,
          }
        case "error":
          return { status: "error", error: event.error, sessionId: event.sessionId }
        default:
          return state
      }
    }

    case "approval_pending": {
      switch (event.type) {
        case "approval_result":
          // 无论批准与否，回到 streaming 继续
          return { status: "streaming", content: state.content, sessionId: event.sessionId }
        case "error":
          return { status: "error", error: event.error, sessionId: event.sessionId }
        default:
          return state
      }
    }

    case "done":
    case "error":
      // 只接受 start（已处理）和 reset（已处理）
      return state
  }
}

/**
 * 创建流式聊天状态机实例。
 *
 * 使用方式：
 * ```ts
 * const machine = createChatStreamState()
 * const s1 = machine.transition({ type: "start", sessionId: "s1" })
 * if (s1.getState().status === "streaming") {
 *   console.log(s1.getState().content)
 * }
 * ```
 */
export function createChatStreamState(): ChatStreamState {
  let current: StreamStateStatus = { status: "idle" }

  return {
    getState(): StreamStateStatus {
      return current
    },
    transition(event: StreamEvent): ChatStreamState {
      const next = transitionState(current, event)
      if (next !== current) {
        current = next
      }
      return this
    },
  }
}
