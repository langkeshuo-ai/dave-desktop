/**
 * Chat Stream Push Channels — 流式聊天推送通道注册与 schema 校验测试
 *
 * 测试目标：
 * 1. 所有 6 个推送通道的 schema 定义正确
 * 2. 合法 payload 通过校验
 * 3. 非法 payload 被拒绝
 * 4. 注册函数可被 chat-loop.ts 调用
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { z } from "zod"
import {
  registerPushChannel,
  pushWithGuard,
  resetPushRegistry,
} from "../src/main/security/ipc-guard"
import type {
  ChatStreamChunk,
  ChatStreamDone,
  ChatStreamError,
  ChatStreamApproval,
  ChatStreamPatch,
  ChatStreamTools,
} from "../src/shared/types"

// ─── 辅助：模拟 WebContents ──────────────────────────

function createMockWebContents() {
  const send = vi.fn()
  return {
    send,
    id: 1,
    isDestroyed: () => false,
  } as unknown as import("electron").WebContents
}

// ─── 6 个推送通道的 Schema 定义 ──────────────────────

const pushChannelSchemas = {
  "chat-stream-chunk": z.object({
    content: z.string(),
    sessionId: z.string().min(1),
    replace: z.boolean().optional(),
  }),
  "chat-stream-done": z.object({
    sessionId: z.string().min(1),
    aborted: z.boolean().optional(),
  }),
  "chat-stream-error": z.object({
    error: z.string(),
    sessionId: z.string().min(1),
  }),
  "chat-stream-tools": z.object({
    sessionId: z.string().min(1),
    tools: z.array(z.string()),
  }),
  "chat-stream-approval": z.object({
    sessionId: z.string().min(1),
    tool: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()),
    mutates: z.boolean(),
    isShell: z.boolean(),
  }),
  "chat-stream-patch": z.object({
    sessionId: z.string().min(1),
    patch: z.string(),
    paths: z.array(z.string()).optional(),
  }),
} as const

// ─── 注册所有推送通道 ────────────────────────────────

function registerAllPushChannels(): void {
  for (const [channel, schema] of Object.entries(pushChannelSchemas)) {
    registerPushChannel(channel, schema)
  }
}

// ─── 有效 payload 工厂 ────────────────────────────────

const factories = {
  "chat-stream-chunk": (overrides?: Partial<ChatStreamChunk>): ChatStreamChunk => ({
    content: "hello",
    sessionId: "sess-1",
    ...overrides,
  }),
  "chat-stream-done": (overrides?: Partial<ChatStreamDone>): ChatStreamDone => ({
    sessionId: "sess-1",
    ...overrides,
  }),
  "chat-stream-error": (overrides?: Partial<ChatStreamError>): ChatStreamError => ({
    error: "something went wrong",
    sessionId: "sess-1",
    ...overrides,
  }),
  "chat-stream-tools": (overrides?: Partial<ChatStreamTools>): ChatStreamTools => ({
    sessionId: "sess-1",
    tools: ["read_file", "edit_file"],
    ...overrides,
  }),
  "chat-stream-approval": (overrides?: Partial<ChatStreamApproval>): ChatStreamApproval => ({
    sessionId: "sess-1",
    tool: "write_file",
    arguments: { path: "/test.txt" },
    mutates: true,
    isShell: false,
    ...overrides,
  }),
  "chat-stream-patch": (overrides?: Partial<ChatStreamPatch>): ChatStreamPatch => ({
    sessionId: "sess-1",
    patch: "diff content",
    ...overrides,
  }),
} as const

// ─── 非法 payload 工厂 ────────────────────────────────

const invalidFactories: Record<string, Array<Record<string, unknown>>> = {
  "chat-stream-chunk": [
    {}, // 缺少 content 和 sessionId
    { content: 123, sessionId: "s1" }, // content 不是 string
    { content: "hi", sessionId: "" }, // sessionId 为空
  ],
  "chat-stream-done": [
    {}, // 缺少 sessionId
    { sessionId: 123 }, // sessionId 不是 string
    { sessionId: "" }, // sessionId 为空
  ],
  "chat-stream-error": [
    {}, // 缺少 error 和 sessionId
    { error: "fail", sessionId: "" }, // sessionId 为空
    { error: 123, sessionId: "s1" }, // error 不是 string
  ],
  "chat-stream-tools": [
    {}, // 缺少 sessionId 和 tools
    { sessionId: "s1", tools: "not-array" }, // tools 不是数组
    { sessionId: "", tools: [] }, // sessionId 为空
  ],
  "chat-stream-approval": [
    {}, // 缺少所有字段
    { sessionId: "s1", tool: "t", arguments: {}, mutates: "yes", isShell: false }, // mutates 不是 boolean
    { sessionId: "s1", tool: "", arguments: {}, mutates: true, isShell: false }, // tool 为空
  ],
  "chat-stream-patch": [
    {}, // 缺少 sessionId 和 patch
    { sessionId: "s1", patch: 123 }, // patch 不是 string
    { sessionId: "", patch: "diff" }, // sessionId 为空
  ],
}

// ─── 测试套件 ─────────────────────────────────────────

const CHANNEL_NAMES = Object.keys(pushChannelSchemas) as Array<keyof typeof pushChannelSchemas>

describe("Chat Stream Push Channels", () => {
  let mockWebContents: import("electron").WebContents

  beforeEach(() => {
    mockWebContents = createMockWebContents()
    resetPushRegistry()
  })

  afterEach(() => {
    resetPushRegistry()
  })

  // ─── 1. 所有通道注册成功 ──────────────────────────

  it("所有 6 个推送通道应注册成功", () => {
    registerAllPushChannels()
    for (const channel of CHANNEL_NAMES) {
      expect(() => pushWithGuard(mockWebContents, channel, {} as any)).not.toThrow(
        /not registered/i,
      )
    }
  })

  // ─── 2. 每个通道接受合法 payload ──────────────────

  for (const channel of CHANNEL_NAMES) {
    it(`${channel} 应接受合法 payload`, () => {
      registerAllPushChannels()
      const payload = (factories as any)[channel]()
      expect(() => pushWithGuard(mockWebContents, channel, payload)).not.toThrow()
      expect((mockWebContents as any).send).toHaveBeenCalledWith(channel, payload)
    })
  }

  // ─── 3. 每个通道拒绝非法 payload ──────────────────

  for (const channel of CHANNEL_NAMES) {
    it(`${channel} 应拒绝非法 payload`, () => {
      registerAllPushChannels()
      const invalidPayloads = invalidFactories[channel]
      for (const invalid of invalidPayloads) {
        expect(() => pushWithGuard(mockWebContents, channel, invalid)).toThrow()
      }
      // send 不应被调用
      expect((mockWebContents as any).send).not.toHaveBeenCalled()
    })
  }

  // ─── 4. 可选的 replace/aborted/paths 字段传输 ─────

  it("chat-stream-chunk 的 replace:true 应传输", () => {
    registerAllPushChannels()
    const payload = factories["chat-stream-chunk"]({ replace: true })
    pushWithGuard(mockWebContents, "chat-stream-chunk", payload)
    expect((mockWebContents as any).send).toHaveBeenCalledWith("chat-stream-chunk", payload)
  })

  it("chat-stream-done 的 aborted:true 应传输", () => {
    registerAllPushChannels()
    const payload = factories["chat-stream-done"]({ aborted: true })
    pushWithGuard(mockWebContents, "chat-stream-done", payload)
    expect((mockWebContents as any).send).toHaveBeenCalledWith("chat-stream-done", payload)
  })

  it("chat-stream-patch 的 paths 数组应传输", () => {
    registerAllPushChannels()
    const payload = factories["chat-stream-patch"]({ paths: ["/a.txt", "/b.txt"] })
    pushWithGuard(mockWebContents, "chat-stream-patch", payload)
    expect((mockWebContents as any).send).toHaveBeenCalledWith("chat-stream-patch", payload)
  })

  // ─── 5. 未注册的通道拒绝 ──────────────────────────

  it("未注册的通道应拒绝", () => {
    registerAllPushChannels()
    // 注册完成后，尝试未注册的通道
    expect(() => {
      pushWithGuard(mockWebContents, "chat-stream-unknown", { sessionId: "s1" })
    }).toThrow(/not registered/i)
  })
})
