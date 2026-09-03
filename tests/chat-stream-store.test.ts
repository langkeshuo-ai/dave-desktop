/**
 * Chat Stream Store — 订阅式 store 测试
 *
 * 目标：验证框架无关的流式聊天 store（基于 chat-stream-state 状态机）。
 * store 提供 useSyncExternalStore 所需的 subscribe/getSnapshot 接口，
 * 并额外提供 dispatch 派发事件。纯 TS，node 环境可单测。
 *
 * 测试范围：
 * 1. 初始快照为 idle
 * 2. dispatch(start) 后快照为 streaming
 * 3. chunk 事件累加 content
 * 4. subscribe 在状态变化时通知
 * 5. unsubscribe 后不再通知
 * 6. 非法转移（idle 直接 done）不通知（状态未变化）
 * 7. 幂等 key 重复事件不重复通知
 * 8. reset 回到 idle 并通知
 * 9. 多个 listener 均收到通知
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChatStreamStore } from "../src/shared/chat-stream-store"
import { resetIdempotentKeys } from "../src/shared/chat-stream-state"

describe("Chat Stream Store", () => {
  beforeEach(() => {
    resetIdempotentKeys()
  })

  // ─── 1. 初始快照 ──────────────────────────────────

  it("初始快照应为 idle", () => {
    const store = createChatStreamStore()
    expect(store.getSnapshot()).toEqual({ status: "idle" })
  })

  // ─── 2. start 事件 ────────────────────────────────

  it("dispatch(start) 后快照应进入 streaming", () => {
    const store = createChatStreamStore()
    store.dispatch({ type: "start", sessionId: "sess-1" })

    const s = store.getSnapshot()
    expect(s.status).toBe("streaming")
    if (s.status === "streaming") {
      expect(s.sessionId).toBe("sess-1")
      expect(s.content).toBe("")
    }
  })

  // ─── 3. chunk 累加 ────────────────────────────────

  it("dispatch(chunk) 应累加 content", () => {
    const store = createChatStreamStore()
    store.dispatch({ type: "start", sessionId: "sess-1" })
    store.dispatch({ type: "chunk", content: "hello", sessionId: "sess-1" })
    store.dispatch({ type: "chunk", content: " world", sessionId: "sess-1" })

    const s = store.getSnapshot()
    expect(s.status).toBe("streaming")
    if (s.status === "streaming") {
      expect(s.content).toBe("hello world")
    }
  })

  // ─── 4. subscribe 通知 ────────────────────────────

  it("状态变化时应通知订阅者", () => {
    const store = createChatStreamStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.dispatch({ type: "start", sessionId: "sess-1" })
    expect(listener).toHaveBeenCalledTimes(1)

    store.dispatch({ type: "chunk", content: "hi", sessionId: "sess-1" })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  // ─── 5. unsubscribe ───────────────────────────────

  it("unsubscribe 后应停止通知", () => {
    const store = createChatStreamStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.dispatch({ type: "start", sessionId: "sess-1" })
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    store.dispatch({ type: "chunk", content: "hi", sessionId: "sess-1" })
    // 已取消订阅，不应再收到通知
    expect(listener).toHaveBeenCalledTimes(1)
  })

  // ─── 6. 非法转移不通知 ────────────────────────────

  it("非法转移（状态未变化）不应通知", () => {
    const store = createChatStreamStore()
    const listener = vi.fn()
    store.subscribe(listener)

    // idle 直接 done 非法 → 状态保持 idle
    store.dispatch({ type: "done", sessionId: "sess-1" })
    expect(listener).not.toHaveBeenCalled()
    expect(store.getSnapshot()).toEqual({ status: "idle" })
  })

  // ─── 7. 幂等 key 去重 ─────────────────────────────

  it("重复幂等 key 的事件不应重复通知", () => {
    const store = createChatStreamStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.dispatch({ type: "start", sessionId: "sess-1" })
    const callsAfterStart = listener.mock.calls.length

    store.dispatch({ type: "chunk", content: "hello", sessionId: "sess-1", idempotentKey: "k1" })
    store.dispatch({ type: "chunk", content: " world", sessionId: "sess-1", idempotentKey: "k1" })

    // start 1 次 + 第一个 chunk 1 次 = 2；重复 chunk 应被跳过
    expect(listener).toHaveBeenCalledTimes(callsAfterStart + 1)

    const s = store.getSnapshot()
    if (s.status === "streaming") {
      expect(s.content).toBe("hello")
    }
  })

  // ─── 8. reset ─────────────────────────────────────

  it("dispatch(reset) 应回到 idle 并通知", () => {
    const store = createChatStreamStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.dispatch({ type: "start", sessionId: "sess-1" })
    store.dispatch({ type: "chunk", content: "partial", sessionId: "sess-1" })
    store.dispatch({ type: "reset" })

    expect(store.getSnapshot()).toEqual({ status: "idle" })
    expect(listener).toHaveBeenCalledTimes(3) // start + chunk + reset
  })

  // ─── 9. 多订阅者 ──────────────────────────────────

  it("多个订阅者应都收到通知", () => {
    const store = createChatStreamStore()
    const l1 = vi.fn()
    const l2 = vi.fn()
    store.subscribe(l1)
    store.subscribe(l2)

    store.dispatch({ type: "start", sessionId: "sess-1" })

    expect(l1).toHaveBeenCalledTimes(1)
    expect(l2).toHaveBeenCalledTimes(1)
  })

  // ─── 10. done 事件 ────────────────────────────────

  it("dispatch(done) 后快照应为 done", () => {
    const store = createChatStreamStore()
    store.dispatch({ type: "start", sessionId: "sess-1" })
    store.dispatch({ type: "chunk", content: "full answer", sessionId: "sess-1" })
    store.dispatch({ type: "done", sessionId: "sess-1" })

    const s = store.getSnapshot()
    expect(s.status).toBe("done")
    if (s.status === "done") {
      expect(s.finalContent).toBe("full answer")
      expect(s.aborted).toBeUndefined()
    }
  })

  // ─── 11. 快照不可变 ───────────────────────────────

  it("getSnapshot 应返回相同引用直到状态变化", () => {
    const store = createChatStreamStore()
    const snap1 = store.getSnapshot()

    // 未派发事件 → 快照引用不变
    expect(store.getSnapshot()).toBe(snap1)

    // 非法转移 → 快照引用不变
    store.dispatch({ type: "done", sessionId: "sess-1" })
    expect(store.getSnapshot()).toBe(snap1)

    // 有效转移 → 新快照
    store.dispatch({ type: "start", sessionId: "sess-1" })
    expect(store.getSnapshot()).not.toBe(snap1)
  })

  // ─── 12. 跨会话 store 幂等 key 不串扰 ─────────────

  it("跨会话 store 使用相同 idempotentKey 互不串扰", () => {
    const storeA = createChatStreamStore()
    storeA.dispatch({ type: "start", sessionId: "sess-a" })
    storeA.dispatch({ type: "chunk", content: "hello", sessionId: "sess-a", idempotentKey: "key-1" })

    // 会话 B 与 A 使用同名 key，应正常累加（不被 A 去重误杀）
    const storeB = createChatStreamStore()
    storeB.dispatch({ type: "start", sessionId: "sess-b" })
    storeB.dispatch({ type: "chunk", content: " world", sessionId: "sess-b", idempotentKey: "key-1" })

    const s = storeB.getSnapshot()
    expect(s.status).toBe("streaming")
    if (s.status === "streaming") {
      expect(s.content).toBe(" world")
    }
  })
})