/**
 * Chat stream events — 通道 payload → StreamEvent 的共享映射（单一事实来源）
 *
 * 主进程经 pushWithGuard 推送 7 个 chat-stream-* 通道；渲染端接收后在 store 中
 * 派发对应 StreamEvent。此映射把"IPC payload 形状"与"状态机事件"之间的转换收敛到一处，
 * 避免主进程 mapEvent 与渲染端 dispatch 两侧各写一份导致漂移。
 * 纯 TS、无副作用，node 环境可单测；渲染端桥接 hook 与主进程 push-channels 均可复用。
 */
import type {
  ChatStreamApproval,
  ChatStreamChunk,
  ChatStreamDone,
  ChatStreamError,
  ChatStreamPatch,
  ChatStreamStart,
  ChatStreamTools,
} from "./types"
import type { StreamEvent } from "./chat-stream-state"

/** 全部流式聊天推送通道名 */
export const CHAT_STREAM_CHANNELS = [
  "chat-stream-start",
  "chat-stream-chunk",
  "chat-stream-done",
  "chat-stream-error",
  "chat-stream-tools",
  "chat-stream-approval",
  "chat-stream-patch",
] as const

export type ChatStreamChannel = (typeof CHAT_STREAM_CHANNELS)[number]

/**
 * 把某通道的 IPC payload 映射为状态机事件。
 * 未知通道抛错（调用方只应传入 CHAT_STREAM_CHANNELS 内的通道）。
 */
export function buildEventFromChannel(channel: string, payload: unknown): StreamEvent {
  switch (channel) {
    case "chat-stream-start": {
      const p = payload as ChatStreamStart
      return { type: "start", sessionId: p.sessionId }
    }
    case "chat-stream-chunk": {
      const p = payload as ChatStreamChunk
      return { type: "chunk", content: p.content, sessionId: p.sessionId, replace: p.replace }
    }
    case "chat-stream-done": {
      const p = payload as ChatStreamDone
      return { type: "done", sessionId: p.sessionId, aborted: p.aborted }
    }
    case "chat-stream-error": {
      const p = payload as ChatStreamError
      return { type: "error", error: p.error, sessionId: p.sessionId }
    }
    case "chat-stream-tools": {
      const p = payload as ChatStreamTools
      return { type: "tools", sessionId: p.sessionId, tools: p.tools }
    }
    case "chat-stream-approval": {
      const p = payload as ChatStreamApproval
      return {
        type: "approval",
        sessionId: p.sessionId,
        tool: p.tool,
        arguments: p.arguments,
        mutates: p.mutates,
        isShell: p.isShell,
      }
    }
    case "chat-stream-patch": {
      const p = payload as ChatStreamPatch
      return { type: "patch", sessionId: p.sessionId, patch: p.patch }
    }
    default:
      throw new Error(`Unknown chat stream channel: ${channel}`)
  }
}