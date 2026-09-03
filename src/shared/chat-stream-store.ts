/**
 * Chat Stream Store — 框架无关的流式聊天 store
 *
 * 基于 chat-stream-state 状态机，提供 React useSyncExternalStore 所需的
 * subscribe / getSnapshot 接口，以及 dispatch 派发事件。
 * 纯 TS、无副作用、无 React / Electron 依赖，可在 vitest node 环境单测。
 *
 * 渲染端使用方式（renderer）：
 * ```ts
 * const store = createChatStreamStore()
 * function ChatView() {
 *   const state = useChatStreamStore(store)
 *   return <div>{state.status}</div>
 * }
 * store.dispatch({ type: "start", sessionId })
 * ```
 *
 * 注意：快照以引用相等判断变化（zustand 同款约定），
 * 状态实际变化时才通知订阅者，非法转移不触发通知。
 */
import {
  createChatStreamState,
  type StreamEvent,
  type StreamStateStatus,
} from "./chat-stream-state"

export interface ChatStreamStore {
  /** 当前状态快照（不可变，引用相等表示未变化） */
  getSnapshot: () => StreamStateStatus
  /** 订阅状态变化；返回取消订阅函数 */
  subscribe: (listener: () => void) => () => void
  /** 派发事件（经状态机转移，非法事件被忽略） */
  dispatch: (event: StreamEvent) => void
}

/**
 * 创建流式聊天 store 实例。
 * 建议每个活跃会话一个实例；会话切换时丢弃旧实例。
 */
export function createChatStreamStore(): ChatStreamStore {
  /** 状态机只有 6 种状态；每次转移都产生新引用 */
  const machine = createChatStreamState()
  const listeners = new Set<() => void>()

  function notify(): void {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    getSnapshot(): StreamStateStatus {
      return machine.getState()
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    dispatch(event: StreamEvent): void {
      const before = machine.getState()
      machine.transition(event)
      const after = machine.getState()
      // 引用相等表示状态未实际变化（非法转移 / 幂等去重），不通知
      if (before !== after) {
        notify()
      }
    },
  }
}
