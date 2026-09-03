/**
 * IPC Push Sequence — 推送通道时序合法性前置断言测试
 *
 * 测试目标：
 * 1. 合法序列（start → chunk → done）全部 send 成功
 * 2. idle 状态直接 done 被拒且不 send
 * 3. done 之后再 chunk 被拒
 * 4. approval 免除时序守卫，不推进状态机，后续 chunk 仍在 streaming 合法
 * 5. 跨会话独立（sess-1 与 sess-2 状态不串扰）
 * 6. resetPushRegistry 清空会话语义与违规统计
 * 7. getPushViolationStats 每通道违规计数正确
 *
 * 说明：
 * - 生产侧推送通道经 registerChatStreamPushChannels() 注册；chunk/done/start
 *   受时序守卫，error/tools/approval/patch 免除守卫（多轮工具循环合法业务模式）。
 * - 状态机 idle 只接受 start，生产已有 chat-stream-start 通道由 chat-loop 播种。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { z } from "zod"
import {
  registerPushChannel,
  pushWithGuard,
  resetPushRegistry,
  getPushViolationStats,
} from "../src/main/security/ipc-guard"
import type { StreamEvent } from "../src/shared/chat-stream-state"
import { registerChatStreamPushChannels } from "../src/main/security/push-channels"

// ─── 辅助：模拟 WebContents ──────────────────────────

function createMockWebContents() {
  const send = vi.fn()
  return {
    send,
    id: 1,
    isDestroyed: () => false,
  } as unknown as import("electron").WebContents
}

// ─── helper 通道：为状态机播种 start ──

/** 播种 start 事件（状态机 idle 只接受 start） */
function registerStartChannel(): void {
  registerPushChannel("test-start", z.object({ sessionId: z.string() }), {
    sessionIdOf: (payload: any) => payload.sessionId,
    mapEvent: (payload: any): StreamEvent => ({ type: "start", sessionId: payload.sessionId }),
  })
}

// ─── 测试套件 ─────────────────────────────────────────

describe("IPC Push Sequence Guard", () => {
  let mockWebContents: import("electron").WebContents

  beforeEach(() => {
    mockWebContents = createMockWebContents()
    resetPushRegistry()
    registerChatStreamPushChannels()
    registerStartChannel()
  })

  afterEach(() => {
    resetPushRegistry()
  })

  // ─── 1. 合法序列 start → chunk → done ─────────────

  it("合法序列（start → chunk → done）应全部 send 成功", () => {
    pushWithGuard(mockWebContents, "test-start", { sessionId: "sess-1" })
    pushWithGuard(mockWebContents, "chat-stream-chunk", { content: "hi", sessionId: "sess-1" })
    pushWithGuard(mockWebContents, "chat-stream-done", { sessionId: "sess-1" })

    expect((mockWebContents as any).send).toHaveBeenCalledTimes(3)
    expect((mockWebContents as any).send).toHaveBeenCalledWith("chat-stream-chunk", {
      content: "hi",
      sessionId: "sess-1",
    })
    expect((mockWebContents as any).send).toHaveBeenCalledWith("chat-stream-done", {
      sessionId: "sess-1",
    })
  })

  // ─── 2. idle 直接 done 被拒 ───────────────────────

  it("idle 状态直接 done 应被拒且不 send", () => {
    expect(() => {
      pushWithGuard(mockWebContents, "chat-stream-done", { sessionId: "sess-1" })
    }).toThrow(/chat-stream-done/)
    expect((mockWebContents as any).send).not.toHaveBeenCalled()
  })

  // ─── 3. done 之后再 chunk 被拒 ────────────────────

  it("done 之后再 chunk 应被拒且不 send", () => {
    pushWithGuard(mockWebContents, "test-start", { sessionId: "sess-1" })
    pushWithGuard(mockWebContents, "chat-stream-done", { sessionId: "sess-1" })

    expect(() => {
      pushWithGuard(mockWebContents, "chat-stream-chunk", { content: "late", sessionId: "sess-1" })
    }).toThrow(/chat-stream-chunk/)
    expect((mockWebContents as any).send).toHaveBeenCalledTimes(2)
  })

  // ─── 4. approval 免守卫序列 ───────────────────────

  it("approval 免时序守卫：不推进状态机，后续 chunk 仍在 streaming 合法", () => {
    pushWithGuard(mockWebContents, "test-start", { sessionId: "sess-1" })
    pushWithGuard(mockWebContents, "chat-stream-approval", {
      sessionId: "sess-1",
      tool: "write_file",
      arguments: { path: "/a.txt" },
      mutates: true,
      isShell: false,
    })
    // approval 不推进守卫状态机，chunk 依旧在 streaming 合法转移
    pushWithGuard(mockWebContents, "chat-stream-chunk", {
      content: "after approval",
      sessionId: "sess-1",
    })

    expect((mockWebContents as any).send).toHaveBeenCalledTimes(3)
    expect((mockWebContents as any).send).toHaveBeenCalledWith("chat-stream-chunk", {
      content: "after approval",
      sessionId: "sess-1",
    })
  })

  // ─── 5. 跨会话独立 ────────────────────────────────

  it("sess-1 与 sess-2 状态不串扰", () => {
    pushWithGuard(mockWebContents, "test-start", { sessionId: "sess-1" })
    pushWithGuard(mockWebContents, "test-start", { sessionId: "sess-2" })
    pushWithGuard(mockWebContents, "chat-stream-done", { sessionId: "sess-1" })

    // sess-1 已 done，再 chunk 应被拒
    expect(() => {
      pushWithGuard(mockWebContents, "chat-stream-chunk", { content: "x", sessionId: "sess-1" })
    }).toThrow(/chat-stream-chunk/)

    // sess-2 仍在 streaming，chunk 应正常
    pushWithGuard(mockWebContents, "chat-stream-chunk", {
      content: "sess2 chunk",
      sessionId: "sess-2",
    })
    expect((mockWebContents as any).send).toHaveBeenCalledWith("chat-stream-chunk", {
      content: "sess2 chunk",
      sessionId: "sess-2",
    })
  })

  // ─── 6. resetPushRegistry 清空会话语义与违规 ──────

  it("resetPushRegistry 应清空会话语义并重置违规统计", () => {
    // 先让 sess-1 进入 streaming
    pushWithGuard(mockWebContents, "test-start", { sessionId: "sess-1" })
    pushWithGuard(mockWebContents, "chat-stream-chunk", { content: "hi", sessionId: "sess-1" })

    // 触发一次违规以让统计非零
    expect(() => {
      pushWithGuard(mockWebContents, "chat-stream-done", { sessionId: "sess-2" })
    }).toThrow()

    resetPushRegistry()

    // 重置后注册表/会话/统计全部清空
    expect(getPushViolationStats()).toEqual({})
    registerChatStreamPushChannels()
    registerStartChannel()

    // sess-1 会话状态已清空，重新播种后再 done 应合法（证明会话语义已重置）
    pushWithGuard(mockWebContents, "test-start", { sessionId: "sess-1" })
    expect(() => {
      pushWithGuard(mockWebContents, "chat-stream-done", { sessionId: "sess-1" })
    }).not.toThrow()
    expect(getPushViolationStats()).toEqual({})
  })

  // ─── 7. getPushViolationStats 计数正确 ────────────

  it("getPushViolationStats 应按通道累计违规次数", () => {
    // idle 直接 done 两次 → done 通道违规 2
    expect(() => {
      pushWithGuard(mockWebContents, "chat-stream-done", { sessionId: "sess-1" })
    }).toThrow()
    expect(() => {
      pushWithGuard(mockWebContents, "chat-stream-done", { sessionId: "sess-2" })
    }).toThrow()

    // done 后再 chunk 一次 → chunk 通道违规 1
    pushWithGuard(mockWebContents, "test-start", { sessionId: "sess-3" })
    pushWithGuard(mockWebContents, "chat-stream-done", { sessionId: "sess-3" })
    expect(() => {
      pushWithGuard(mockWebContents, "chat-stream-chunk", { content: "late", sessionId: "sess-3" })
    }).toThrow()

    const stats = getPushViolationStats()
    expect(stats["chat-stream-done"]).toBe(2)
    expect(stats["chat-stream-chunk"]).toBe(1)
  })
})
