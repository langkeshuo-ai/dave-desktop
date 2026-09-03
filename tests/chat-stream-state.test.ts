/**
 * Chat Stream State Machine — 纯函数状态机测试
 *
 * 测试目标：
 * 1. 初始状态为 idle
 * 2. start 事件 → streaming 状态
 * 3. chunk 事件 → 累加 content
 * 4. chunk 事件 replace=true → 替换 content
 * 5. done 事件 → done 状态
 * 6. error 事件 → error 状态
 * 7. tools 事件 → tool_pending 状态
 * 8. approval 事件 → approval_pending 状态
 * 9. 从 approval_pending 的 approval_result → streaming
 * 10. 非法状态转移 → 拒绝（不改变状态）
 * 11. 幂等 key 去重
 * 12. reset 事件 → 回到 idle
 * 13. 断线重连场景：start 中断已有 streaming
 */
import { describe, it, expect, beforeEach } from "vitest"
import { createChatStreamState, resetIdempotentKeys } from "../src/shared/chat-stream-state"

describe("Chat Stream State Machine", () => {
  beforeEach(() => {
    resetIdempotentKeys()
  })

  // ─── 1. 初始状态 ─────────────────────────────────

  it("初始状态应为 idle", () => {
    const state = createChatStreamState()
    expect(state.getState().status).toBe("idle")
  })

  // ─── 2. start → streaming ───────────────────────

  it("start 事件应从 idle 进入 streaming 状态", () => {
    const state = createChatStreamState()
    const next = state.transition({ type: "start", sessionId: "sess-1" })
    const s = next.getState()
    expect(s.status).toBe("streaming")
    if (s.status === "streaming") {
      expect(s.sessionId).toBe("sess-1")
      expect(s.content).toBe("")
    }
  })

  // ─── 3. chunk 累加 content ──────────────────────

  it("chunk 事件应累加 content", () => {
    const state = createChatStreamState()
    const s1 = state.transition({ type: "start", sessionId: "sess-1" })
    const s2 = s1.transition({ type: "chunk", content: "hello", sessionId: "sess-1" })
    const s3 = s2.transition({ type: "chunk", content: " world", sessionId: "sess-1" })

    const s = s3.getState()
    expect(s.status).toBe("streaming")
    if (s.status === "streaming") {
      expect(s.content).toBe("hello world")
    }
  })

  // ─── 4. chunk replace=true → 替换 ────────────────

  it("chunk 事件 replace=true 应替换 content", () => {
    const state = createChatStreamState()
    const s1 = state.transition({ type: "start", sessionId: "sess-1" })
    const s2 = s1.transition({ type: "chunk", content: "hello", sessionId: "sess-1" })
    const s3 = s2.transition({
      type: "chunk",
      content: "replaced",
      sessionId: "sess-1",
      replace: true,
    })

    const s = s3.getState()
    expect(s.status).toBe("streaming")
    if (s.status === "streaming") {
      expect(s.content).toBe("replaced")
    }
  })

  // ─── 5. done → 结束 ─────────────────────────────

  it("done 事件应从 streaming 进入 done 状态", () => {
    const state = createChatStreamState()
    const s1 = state.transition({ type: "start", sessionId: "sess-1" })
    const s2 = s1.transition({ type: "done", sessionId: "sess-1" })

    const s = s2.getState()
    expect(s.status).toBe("done")
    if (s.status === "done") {
      expect(s.sessionId).toBe("sess-1")
    }
  })

  // ─── 6. error → 错误状态 ────────────────────────

  it("error 事件应从 streaming 进入 error 状态", () => {
    const state = createChatStreamState()
    const s1 = state.transition({ type: "start", sessionId: "sess-1" })
    const s2 = s1.transition({ type: "error", error: "Something went wrong", sessionId: "sess-1" })

    const s = s2.getState()
    expect(s.status).toBe("error")
    if (s.status === "error") {
      expect(s.error).toBe("Something went wrong")
    }
  })

  // ─── 7. tools → tool_pending ─────────────────────

  it("tools 事件应从 streaming 进入 tool_pending 状态", () => {
    const state = createChatStreamState()
    const s1 = state.transition({ type: "start", sessionId: "sess-1" })
    const s2 = s1.transition({
      type: "tools",
      sessionId: "sess-1",
      tools: ["read_file", "edit_file"],
    })

    const s = s2.getState()
    expect(s.status).toBe("tool_pending")
    if (s.status === "tool_pending") {
      expect(s.sessionId).toBe("sess-1")
      expect(s.tools).toEqual(["read_file", "edit_file"])
    }
  })

  // ─── 8. approval → approval_pending ──────────────

  it("approval 事件应从 streaming 进入 approval_pending 状态", () => {
    const state = createChatStreamState()
    const s1 = state.transition({ type: "start", sessionId: "sess-1" })
    const s2 = s1.transition({
      type: "approval",
      sessionId: "sess-1",
      tool: "write_file",
      arguments: { path: "/test.txt" },
      mutates: true,
      isShell: false,
    })

    const s = s2.getState()
    expect(s.status).toBe("approval_pending")
    if (s.status === "approval_pending") {
      expect(s.sessionId).toBe("sess-1")
      expect(s.tool).toBe("write_file")
    }
  })

  // ─── 9. approval_result → streaming ─────────────

  it("approval_result 应从 approval_pending 回到 streaming", () => {
    const state = createChatStreamState()
    const s1 = state.transition({ type: "start", sessionId: "sess-1" })
    const s2 = s1.transition({
      type: "approval",
      sessionId: "sess-1",
      tool: "write_file",
      arguments: { path: "/test.txt" },
      mutates: true,
      isShell: false,
    })
    const s3 = s2.transition({ type: "approval_result", sessionId: "sess-1", approved: true })

    const s = s3.getState()
    expect(s.status).toBe("streaming")
    if (s.status === "streaming") {
      expect(s.sessionId).toBe("sess-1")
    }
  })

  // ─── 10. 非法转移 ───────────────────────────────

  it("非法状态转移应拒绝（不改变状态）", () => {
    const state = createChatStreamState()
    // 从 idle 直接 done → 非法
    const s1 = state.transition({ type: "done", sessionId: "sess-1" })
    expect(s1.getState().status).toBe("idle")

    // 从 idle 直接 chunk → 非法
    const s2 = state.transition({ type: "chunk", content: "test", sessionId: "sess-1" })
    expect(s2.getState().status).toBe("idle")

    // 从 done 状态再 chunk → 非法
    const s3 = state.transition({ type: "start", sessionId: "sess-1" })
    const s4 = s3.transition({ type: "done", sessionId: "sess-1" })
    const s5 = s4.transition({ type: "chunk", content: "should not work", sessionId: "sess-1" })
    expect(s5.getState().status).toBe("done")
  })

  // ─── 11. reset → idle ───────────────────────────

  it("reset 事件应从任何状态回到 idle", () => {
    const state = createChatStreamState()
    const s1 = state.transition({ type: "start", sessionId: "sess-1" })
    const s2 = s1.transition({ type: "error", error: "fail", sessionId: "sess-1" })
    const s3 = s2.transition({ type: "reset" })

    expect(s3.getState().status).toBe("idle")
  })

  // ─── 12. patch 事件 ─────────────────────────────

  it("patch 事件不污染正文流（diff 是独立载体，content 保持）", () => {
    const state = createChatStreamState()
    const s1 = state.transition({ type: "start", sessionId: "sess-1" })
    const s2 = s1.transition({ type: "chunk", content: "Hello world", sessionId: "sess-1" })
    const s3 = s2.transition({ type: "patch", sessionId: "sess-1", patch: "--- a/x\n+++ b/x" })
    const s4 = s3.transition({ type: "chunk", content: " again", sessionId: "sess-1" })

    const s = s4.getState()
    expect(s.status).toBe("streaming")
    if (s.status === "streaming") {
      expect(s.content).toBe("Hello world again")
    }
  })

  // ─── 13. 断线重连：start 中断已有 streaming ────

  it("start 事件应中断已有 streaming 并重新开始", () => {
    const state = createChatStreamState()
    const s1 = state.transition({ type: "start", sessionId: "sess-1" })
    const s2 = s1.transition({ type: "chunk", content: "old content", sessionId: "sess-1" })

    // 新的 start 应重置
    const s3 = s2.transition({ type: "start", sessionId: "sess-1" })
    const s = s3.getState()
    expect(s.status).toBe("streaming")
    if (s.status === "streaming") {
      expect(s.content).toBe("")
    }
  })

  // ─── 14. 幂等 key 去重 ──────────────────────────

  it("带有已处理幂等 key 的事件应被跳过", () => {
    const state = createChatStreamState()
    const s1 = state.transition({ type: "start", sessionId: "sess-1" })
    // 两次相同 idempotentKey 的 chunk
    const s2 = s1.transition({
      type: "chunk",
      content: "hello",
      sessionId: "sess-1",
      idempotentKey: "key-1",
    })
    const s3 = s2.transition({
      type: "chunk",
      content: " world",
      sessionId: "sess-1",
      idempotentKey: "key-1",
    })
    // 相同的 key 应被跳过
    const s = s3.getState()
    expect(s.status).toBe("streaming")
    if (s.status === "streaming") {
      expect(s.content).toBe("hello") // 没有累加 " world"
    }
  })

  // ─── 15. done 事件的 aborted 标记 ───────────────

  it("aborted 的 done 应保留标记", () => {
    const state = createChatStreamState()
    const s1 = state.transition({ type: "start", sessionId: "sess-1" })
    const s2 = s1.transition({ type: "chunk", content: "partial", sessionId: "sess-1" })
    const s3 = s2.transition({ type: "done", sessionId: "sess-1", aborted: true })

    const s = s3.getState()
    expect(s.status).toBe("done")
    if (s.status === "done") {
      expect(s.aborted).toBe(true)
      expect(s.finalContent).toBe("partial")
    }
  })

  // ─── 16. 幂等 key 会话命名空间化（跨会话不串扰） ───

  it("不同会话使用相同 idempotentKey 互不影响", () => {
    // 会话 A 先处理 key-1
    const a = createChatStreamState()
    a.transition({ type: "start", sessionId: "sess-a" })
    a.transition({ type: "chunk", content: "hello", sessionId: "sess-a", idempotentKey: "key-1" })

    // 会话 B 使用与 A 相同的 idempotentKey，应正常累加（不被 A 误杀）
    const b = createChatStreamState()
    b.transition({ type: "start", sessionId: "sess-b" })
    const b1 = b.transition({
      type: "chunk",
      content: " world",
      sessionId: "sess-b",
      idempotentKey: "key-1",
    })

    const s = b1.getState()
    expect(s.status).toBe("streaming")
    if (s.status === "streaming") {
      expect(s.content).toBe(" world")
    }
  })

  it("同一状态机切换会话后，同名 idempotentKey 互不影响", () => {
    const m = createChatStreamState()
    m.transition({ type: "start", sessionId: "sess-a" })
    m.transition({ type: "chunk", content: "from A", sessionId: "sess-a", idempotentKey: "key-1" })

    // 切换到会话 B 后，同名 key 应作为全新 key 处理
    m.transition({ type: "start", sessionId: "sess-b" })
    const s = m
      .transition({ type: "chunk", content: "from B", sessionId: "sess-b", idempotentKey: "key-1" })
      .getState()
    expect(s.status).toBe("streaming")
    if (s.status === "streaming") {
      expect(s.content).toBe("from B")
    }
  })

  // ─── 17. start 后同会话同 key 重放（重连场景） ───

  it("start 后同一会话同名 idempotentKey 允许重放（重连）", () => {
    const m = createChatStreamState()
    m.transition({ type: "start", sessionId: "sess-1" })
    m.transition({ type: "chunk", content: "hi", sessionId: "sess-1", idempotentKey: "key-1" })

    // 断线重连：新 start 清空该会话幂等集，允许同 key 重放
    m.transition({ type: "start", sessionId: "sess-1" })
    const s = m
      .transition({
        type: "chunk",
        content: "hi again",
        sessionId: "sess-1",
        idempotentKey: "key-1",
      })
      .getState()
    expect(s.status).toBe("streaming")
    if (s.status === "streaming") {
      expect(s.content).toBe("hi again")
    }
  })

  // ─── 18. reset 清空幂等集合 ────────────────────

  it("reset 后幂等集合应被清空，同名 idempotentKey 允许重放", () => {
    const m = createChatStreamState()
    m.transition({ type: "start", sessionId: "sess-1" })
    m.transition({ type: "chunk", content: "hi", sessionId: "sess-1", idempotentKey: "key-1" })
    m.transition({ type: "chunk", content: "dup", sessionId: "sess-1", idempotentKey: "key-1" }) // 去重跳过

    m.transition({ type: "reset" })
    m.transition({ type: "start", sessionId: "sess-1" })
    const s = m
      .transition({
        type: "chunk",
        content: "after reset",
        sessionId: "sess-1",
        idempotentKey: "key-1",
      })
      .getState()
    expect(s.status).toBe("streaming")
    if (s.status === "streaming") {
      expect(s.content).toBe("after reset")
    }
  })

  // ─── 19. 工具轮中请求审批（tool_pending → approval_pending） ───

  it("tool_pending 状态下 approval 应进入 approval_pending", () => {
    const m = createChatStreamState()
    m.transition({ type: "start", sessionId: "sess-1" })
    m.transition({ type: "tools", sessionId: "sess-1", tools: ["file_tree"] })
    const s = m
      .transition({
        type: "approval",
        sessionId: "sess-1",
        tool: "file_tree",
        arguments: { depth: 1 },
        mutates: false,
        isShell: false,
      })
      .getState()

    expect(s.status).toBe("approval_pending")
    if (s.status === "approval_pending") {
      expect(s.tool).toBe("file_tree")
      expect(s.toolArgs).toEqual({ depth: 1 })
    }
  })

  // ─── 20. 幂等键按会话命名空间隔离（A 会话的 key 不影响 B 会话） ───

  it("不同会话的同名 idempotentKey 互不影响", () => {
    const m = createChatStreamState()
    m.transition({ type: "start", sessionId: "sess-a" })
    const sA = m
      .transition({ type: "chunk", content: "a", sessionId: "sess-a", idempotentKey: "k1" })
      .getState()
    m.transition({ type: "start", sessionId: "sess-b" })
    const sB = m
      .transition({ type: "chunk", content: "b", sessionId: "sess-b", idempotentKey: "k1" })
      .getState()
    expect(sB.status).toBe("streaming")
    if (sB.status === "streaming") {
      expect(sB.content).toBe("b")
    }
    expect(sA.status).toBe("streaming")
  })
})
