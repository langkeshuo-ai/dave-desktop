/**
 * IPC Push Channel Guard — 推送通道注册与校验测试
 *
 * 测试目标：
 * 1. registerPushChannel 注册通道和 schema
 * 2. pushWithGuard 校验 payload 并通过 webContents.send 发送
 * 3. pushWithGuard 拒绝非法 payload
 * 4. pushWithGuard 拒绝未注册通道
 * 5. 重复注册抛出错误
 * 6. 限流功能
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { z } from "zod"

// ─── 待测试模块（尚不存在，在 RED 阶段会失败） ───────

// 这些函数将从 ipc-guard.ts 中导出
// 当前不存在，所以导入会失败——这正是 RED 阶段要验证的
import {
  registerPushChannel,
  pushWithGuard,
  resetPushRegistry,
  getPushChannelRegistry,
  clearSessionGuardState,
  getPushViolationStats,
  channelSchemas,
} from "../src/main/security/ipc-guard"
import type { StreamEvent } from "../src/shared/chat-stream-state"

// ─── 辅助：模拟 WebContents ──────────────────────────

function createMockWebContents() {
  const send = vi.fn()
  return {
    send,
    // Electron 的 WebContents 要求的最小接口
    id: 1,
    isDestroyed: () => false,
  } as unknown as import("electron").WebContents
}

// ─── 测试套件 ─────────────────────────────────────────

describe("IPC Push Channel Guard", () => {
  let mockWebContents: import("electron").WebContents

  beforeEach(() => {
    mockWebContents = createMockWebContents()
    resetPushRegistry()
  })

  afterEach(() => {
    resetPushRegistry()
  })

  // ─── 1. 注册通道 ─────────────────────────────────

  it("registerPushChannel 应注册通道并存储 schema", () => {
    const schema = z.object({ text: z.string() })
    registerPushChannel("chat-stream-chunk", schema)

    const registry = getPushChannelRegistry()
    expect(registry.has("chat-stream-chunk")).toBe(true)
  })

  // ─── 2. 注册后 pushWithGuard 可发送有效 payload ──

  it("pushWithGuard 应校验 payload 并通过 webContents.send 发送", () => {
    const schema = z.object({ content: z.string(), sessionId: z.string() })
    registerPushChannel("chat-stream-chunk", schema)

    const payload = { content: "hello", sessionId: "sess-1" }
    pushWithGuard(mockWebContents, "chat-stream-chunk", payload)

    // webContents.send 应被调用，且 payload 已被校验通过
    expect((mockWebContents as any).send).toHaveBeenCalledTimes(1)
    expect((mockWebContents as any).send).toHaveBeenCalledWith("chat-stream-chunk", payload)
  })

  // ─── 3. 拒绝非法 payload ─────────────────────────

  it("pushWithGuard 应拒绝不符合 schema 的 payload", () => {
    const schema = z.object({ content: z.string() })
    registerPushChannel("chat-stream-chunk", schema)

    // content 应该是 string，但给了 number
    expect(() => {
      pushWithGuard(mockWebContents, "chat-stream-chunk", { content: 123 })
    }).toThrow()
    expect((mockWebContents as any).send).not.toHaveBeenCalled()
  })

  // ─── 4. 拒绝未注册通道 ───────────────────────────

  it("pushWithGuard 应拒绝未注册的通道", () => {
    expect(() => {
      pushWithGuard(mockWebContents, "unknown-channel", { data: "test" })
    }).toThrow(/not registered/i)
    expect((mockWebContents as any).send).not.toHaveBeenCalled()
  })

  // ─── 5. 重复注册抛出错误 ─────────────────────────

  it("重复注册同一通道应抛出错误", () => {
    const schema = z.object({ text: z.string() })
    registerPushChannel("duplicate-channel", schema)

    expect(() => {
      registerPushChannel("duplicate-channel", z.object({ other: z.number() }))
    }).toThrow(/already registered/i)
  })

  // ─── 6. 限流功能 ─────────────────────────────────

  it("超过限流时应拒绝发送并抛出错误", () => {
    const schema = z.object({ text: z.string() })
    registerPushChannel("rate-limited", schema, { rateLimit: { max: 2, windowMs: 1000 } })

    pushWithGuard(mockWebContents, "rate-limited", { text: "first" })
    pushWithGuard(mockWebContents, "rate-limited", { text: "second" })

    // 第三次应触发限流
    expect(() => {
      pushWithGuard(mockWebContents, "rate-limited", { text: "third" })
    }).toThrow(/rate limit/i)
    expect((mockWebContents as any).send).toHaveBeenCalledTimes(2)
  })

  // ─── 7. 空通道名应拒绝 ───────────────────────────

  it("空通道名应拒绝注册", () => {
    expect(() => {
      registerPushChannel("", z.object({}))
    }).toThrow()
  })

  // ─── 8. 多个通道可独立注册和发送 ─────────────────

  it("多个通道可独立注册和使用", () => {
    const chunkSchema = z.object({ content: z.string(), sessionId: z.string() })
    const doneSchema = z.object({ sessionId: z.string(), aborted: z.boolean().optional() })
    const errorSchema = z.object({ error: z.string(), sessionId: z.string() })

    registerPushChannel("chat-stream-chunk", chunkSchema)
    registerPushChannel("chat-stream-done", doneSchema)
    registerPushChannel("chat-stream-error", errorSchema)

    pushWithGuard(mockWebContents, "chat-stream-chunk", { content: "hi", sessionId: "s1" })
    pushWithGuard(mockWebContents, "chat-stream-done", { sessionId: "s1" })
    pushWithGuard(mockWebContents, "chat-stream-error", { error: "fail", sessionId: "s1" })

    expect((mockWebContents as any).send).toHaveBeenCalledTimes(3)
  })

  // ─── 9. 会话守卫状态可被清除（deleteSession 联动） ──────

  it("终态后非法推送被拒；clearSessionGuardState 后同会话可重新播种", () => {
    const startSchema = z.object({ sessionId: z.string() })
    const chunkSchema = z.object({ content: z.string(), sessionId: z.string() })
    const doneSchema = z.object({ sessionId: z.string() })
    const mapEvent =
      (type: "start" | "chunk" | "done") =>
      (p: any): StreamEvent =>
        type === "done"
          ? { type: "done", sessionId: p.sessionId }
          : type === "chunk"
            ? { type: "chunk", content: p.content, sessionId: p.sessionId }
            : { type: "start", sessionId: p.sessionId }
    registerPushChannel("seq-start", startSchema, {
      sessionIdOf: (p: any) => p.sessionId,
      mapEvent: mapEvent("start"),
    })
    registerPushChannel("seq-chunk", chunkSchema, {
      sessionIdOf: (p: any) => p.sessionId,
      mapEvent: mapEvent("chunk"),
    })
    registerPushChannel("seq-done", doneSchema, {
      sessionIdOf: (p: any) => p.sessionId,
      mapEvent: mapEvent("done"),
    })

    // 正常一轮：start → chunk → done
    pushWithGuard(mockWebContents, "seq-start", { sessionId: "sess-x" })
    pushWithGuard(mockWebContents, "seq-chunk", { content: "a", sessionId: "sess-x" })
    pushWithGuard(mockWebContents, "seq-done", { sessionId: "sess-x" })

    // done 终态后再 chunk：未清除时被拒（异常序列防护）
    expect(() => {
      pushWithGuard(mockWebContents, "seq-chunk", { content: "late", sessionId: "sess-x" })
    }).toThrow(/Illegal stream transition/)

    // 清除守卫状态后：同会话重新播种流转不再违规
    clearSessionGuardState("sess-x")
    pushWithGuard(mockWebContents, "seq-start", { sessionId: "sess-x" })
    pushWithGuard(mockWebContents, "seq-chunk", { content: "b", sessionId: "sess-x" })

    // 违规计数应清零（清的是状态机缓存，违规计数独立保留——此处仅验证未新增违规）
    expect(getPushViolationStats()["seq-chunk"]).toBe(1)
    expect((mockWebContents as any).send).toHaveBeenCalledTimes(5)
  })

  // ─── 10. 守卫豁免面契约：error/tools/approval/patch 任意状态不触发违规 ──

  it("exempt 通道（error/tools/approval/patch）任意业务状态推送不触发守卫", () => {
    const startSchema = z.object({ sessionId: z.string() })
    const chunkSchema = z.object({ content: z.string(), sessionId: z.string() })
    const exemptSchemas = {
      "x-error": z.object({ error: z.string(), sessionId: z.string() }),
      "x-tools": z.object({ sessionId: z.string(), tools: z.array(z.string()) }),
      "x-approval": z.object({
        sessionId: z.string(),
        tool: z.string(),
        arguments: z.record(z.string(), z.unknown()),
        mutates: z.boolean(),
        isShell: z.boolean(),
      }),
      "x-patch": z.object({ sessionId: z.string(), patch: z.string() }),
    }
    // 内容级通道带守卫；exempt 通道不配 mapEvent
    registerPushChannel("x-error", exemptSchemas["x-error"])
    registerPushChannel("x-tools", exemptSchemas["x-tools"])
    registerPushChannel("x-approval", exemptSchemas["x-approval"])
    registerPushChannel("x-patch", exemptSchemas["x-patch"])
    registerPushChannel("x-start", startSchema, {
      sessionIdOf: (p: any) => p.sessionId,
      mapEvent: (p: any) => ({ type: "start", sessionId: p.sessionId }),
    })
    registerPushChannel("x-chunk", chunkSchema, {
      sessionIdOf: (p: any) => p.sessionId,
      mapEvent: (p: any) => ({ type: "chunk", content: p.content, sessionId: p.sessionId }),
    })

    // 完整 agent 工具轮 + 异常穿插：exempt 通道任意状态均可推送
    pushWithGuard(mockWebContents, "x-start", { sessionId: "sess-y" })
    pushWithGuard(mockWebContents, "x-chunk", { content: "a", sessionId: "sess-y" })
    pushWithGuard(mockWebContents, "x-tools", { sessionId: "sess-y", tools: ["t1"] })
    pushWithGuard(mockWebContents, "x-approval", {
      sessionId: "sess-y",
      tool: "t1",
      arguments: {},
      mutates: false,
      isShell: false,
    })
    pushWithGuard(mockWebContents, "x-patch", { sessionId: "sess-y", patch: "diff" })
    pushWithGuard(mockWebContents, "x-error", { error: "mid-fail", sessionId: "sess-y" })
    pushWithGuard(mockWebContents, "x-chunk", { content: "b", sessionId: "sess-y" })

    expect(getPushViolationStats()).toEqual({})
    expect((mockWebContents as any).send).toHaveBeenCalledTimes(7)
  })

  // ─── 11. channelSchemas.skillNames 边界校验（skills:fs-system-prompt） ──

  it("skillNames schema 接受合法技能名数组", () => {
    const r = channelSchemas.skillNames.safeParse([["skill-a", "skill_b", "skill-2"]])
    expect(r.success).toBe(true)
  })

  it("skillNames schema 拒绝空数组 / 超限数组 / 非字符串元素", () => {
    expect(channelSchemas.skillNames.safeParse([[]]).success).toBe(false)
    expect(
      channelSchemas.skillNames.safeParse([[Array.from({ length: 33 }, (_, i) => `s${i}`)]])
        .success,
    ).toBe(false)
    expect(channelSchemas.skillNames.safeParse([[null]]).success).toBe(false)
    expect(channelSchemas.skillNames.safeParse([["ok", 42]]).success).toBe(false)
  })
})
