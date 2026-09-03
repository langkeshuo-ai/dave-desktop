/**
 * useChatStreamStore — React hook：把流式聊天 store 接入 React 并发调度
 *
 * 使用 useSyncExternalStore 订阅 chat-stream-store（React 18+ 并发安全）：
 * - 并发渲染期间读到一致快照，撕裂被禁止
 * - 状态变化时自动重渲染，无需手动 setState
 *
 * 使用方式（ChatView）：
 * ```tsx
 * const store = useMemo(() => createChatStreamStore(), [sessionId])
 * const state = useChatStreamStore(store)
 * // state: { status: "streaming", content, sessionId } | ...
 * ```
 *
 * IPC 事件接线（useEffect 内一次性订阅）：
 * ```tsx
 * useEffect(() => {
 *   const off1 = window.api.onChatChunk((p) => store.dispatch({ type: "chunk", ...p }))
 *   const off2 = window.api.onChatDone((p) => store.dispatch({ type: "done", ...p }))
 *   return () => { off1(); off2() }
 * }, [store])
 * ```
 */
import { useSyncExternalStore } from "react"
import type { ChatStreamStore } from "../../shared/chat-stream-store"
import type { StreamStateStatus } from "../../shared/chat-stream-state"

/**
 * 订阅 store 的最新状态快照。
 * 状态未变化时返回同一引用，避免无谓重渲染。
 */
export function useChatStreamStore(store: ChatStreamStore): StreamStateStatus {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
