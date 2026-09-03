/**
 * useChatStreamBridge — 渲染端桥接 hook：IPC 流式事件 → store.dispatch
 *
 * 职责：
 * 1. 一次性订阅主进程 7 个 chat-stream-* 通道（经 preload window.dave.chat 的
 *    onStart/onChunk/onDone/onError/onTools/onApproval/onPatch）。
 * 2. sessionId 过滤：残留事件跨会话污染被拦截（与主进程守卫同款防御）。
 * 3. 通道 payload → StreamEvent 复用共享映射 buildEventFromChannel，与主进程
 *    mapEvent 共用一份转换语义，杜绝双写漂移。
 * 4. 暴露 approve(boolean) / abort()：
 *    - approve：调 IPC chat-approve 让主进程继续/拒绝工具，并本地派发
 *      approval_result 推进状态机（approval_pending → streaming）。
 *    - abort：调 IPC chat-abort，等待 onDone(aborted) 保留 partial。
 *
 * 使用（ChatView）：
 *   const store = useMemo(() => createChatStreamStore(), [sessionId])
 *   const state = useChatStreamStore(store)
 *   const bridge = useChatStreamBridge(store, sessionId)
 */
import { useCallback, useEffect } from "react"
import type { ChatStreamStore } from "../../shared/chat-stream-store"
import { buildEventFromChannel } from "../../shared/chat-stream-events"
import type { StreamEvent } from "../../shared/chat-stream-state"
import type { DaveApi } from "../../preload"

declare global {
  interface Window {
    dave: DaveApi
  }
}

export interface ChatStreamBridge {
  /** 用户对当前审批作出决定：同步主进程并本地推进状态机 */
  approve: (approved: boolean) => void
  /** 中止当前输出：主进程回推 done{aborted} 后由 onDone 保留 partial */
  abort: () => void
}

/** 桥接 hook 内部暴露的订阅器，供组件测试或未来扩展使用 */
export type ChatStreamUnsubscribe = () => void

export function useChatStreamBridge(
  store: ChatStreamStore,
  sessionId: string,
  onEvent?: (event: StreamEvent) => void,
): ChatStreamBridge {
  useEffect(() => {
    const dave = window.dave?.chat
    if (!dave) return

    const dispatch = (channel: Parameters<typeof buildEventFromChannel>[0], payload: unknown) => {
      // sessionId 过滤：仅派发属于当前会话的事件
      const p = payload as { sessionId?: string } | null
      if (p?.sessionId && p.sessionId !== sessionId) return
      const event = buildEventFromChannel(channel, payload)
      store.dispatch(event)
      onEvent?.(event)
    }

    const offs: ChatStreamUnsubscribe[] = [
      dave.onStart((p) => dispatch("chat-stream-start", p)),
      dave.onChunk((p) => dispatch("chat-stream-chunk", p)),
      dave.onDone((p) => dispatch("chat-stream-done", p)),
      dave.onError((p) => dispatch("chat-stream-error", p)),
      dave.onTools((p) => dispatch("chat-stream-tools", p)),
      dave.onApproval((p) => dispatch("chat-stream-approval", p)),
      dave.onPatch((p) => dispatch("chat-stream-patch", p)),
    ]
    return () => offs.forEach((off) => off())
  }, [store, sessionId, onEvent])

  const approve = useCallback(
    (approved: boolean) => {
      window.dave.chat.approve(sessionId, approved).catch(() => {})
      // 本地推进状态机：approval_pending → streaming
      store.dispatch({ type: "approval_result", sessionId, approved })
    },
    [store, sessionId],
  )

  const abort = useCallback(() => {
    window.dave.chat.abort(sessionId).catch(() => {})
    // 主进程回推 done{aborted:true}，onDone 让 store 落 done 并保留 partial
  }, [sessionId])

  return { approve, abort }
}