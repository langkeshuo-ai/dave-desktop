/**
 * Chat stream events — 通道 payload → StreamEvent 映射单测
 *
 * 保护风险：
 * 1. 7 个通道的 payload 字段透传正确（类型/键名漂移会让渲染端状态机收到缺字段事件）
 * 2. 未知通道必须拒绝（防止误映射静默吞掉异常通道）
 * 3. 可选字段（replace/aborted）透传
 */
import { describe, it, expect } from "vitest"
import {
  buildEventFromChannel,
  CHAT_STREAM_CHANNELS,
  type ChatStreamChannel,
} from "../src/shared/chat-stream-events"
import type {
  ChatStreamApproval,
  ChatStreamChunk,
  ChatStreamDone,
  ChatStreamError,
  ChatStreamPatch,
  ChatStreamStart,
  ChatStreamTools,
} from "../src/shared/types"

describe("buildEventFromChannel", () => {
  const sess = "sess-1"

  it("chat-stream-start → start 事件", () => {
    const p: ChatStreamStart = { sessionId: sess }
    expect(buildEventFromChannel("chat-stream-start", p)).toEqual({
      type: "start",
      sessionId: sess,
    })
  })

  it("chat-stream-chunk → chunk 事件（含可选 replace 透传）", () => {
    const p: ChatStreamChunk = { content: "你好", sessionId: sess }
    expect(buildEventFromChannel("chat-stream-chunk", p)).toEqual({
      type: "chunk",
      content: "你好",
      sessionId: sess,
      replace: undefined,
    })
    const p2: ChatStreamChunk = { content: "重置", sessionId: sess, replace: true }
    expect(buildEventFromChannel("chat-stream-chunk", p2).type).toBe("chunk")
  })

  it("chat-stream-done → done 事件（含 aborted 透传）", () => {
    const p: ChatStreamDone = { sessionId: sess }
    expect(buildEventFromChannel("chat-stream-done", p)).toEqual({
      type: "done",
      sessionId: sess,
      aborted: undefined,
    })
    const p2: ChatStreamDone = { sessionId: sess, aborted: true }
    const ev = buildEventFromChannel("chat-stream-done", p2)
    expect(ev.type).toBe("done")
    if (ev.type === "done") expect(ev.aborted).toBe(true)
  })

  it("chat-stream-error → error 事件", () => {
    const p: ChatStreamError = { error: "boom", sessionId: sess }
    expect(buildEventFromChannel("chat-stream-error", p)).toEqual({
      type: "error",
      error: "boom",
      sessionId: sess,
    })
  })

  it("chat-stream-tools → tools 事件", () => {
    const p: ChatStreamTools = { sessionId: sess, tools: ["read_file", "write_file"] }
    expect(buildEventFromChannel("chat-stream-tools", p)).toEqual({
      type: "tools",
      sessionId: sess,
      tools: ["read_file", "write_file"],
    })
  })

  it("chat-stream-approval → approval 事件（含 mutates/isShell/arguments）", () => {
    const p: ChatStreamApproval = {
      sessionId: sess,
      tool: "write_file",
      arguments: { path: "/a.txt" },
      mutates: true,
      isShell: false,
    }
    expect(buildEventFromChannel("chat-stream-approval", p)).toEqual({
      type: "approval",
      sessionId: sess,
      tool: "write_file",
      arguments: { path: "/a.txt" },
      mutates: true,
      isShell: false,
    })
  })

  it("chat-stream-patch → patch 事件", () => {
    const p: ChatStreamPatch = { sessionId: sess, patch: "@@ -1 +1 @@" }
    expect(buildEventFromChannel("chat-stream-patch", p)).toEqual({
      type: "patch",
      sessionId: sess,
      patch: "@@ -1 +1 @@",
    })
  })

  it("未知通道抛错（拒绝静默误映射）", () => {
    expect(() => buildEventFromChannel("chat-stream-unknown", {})).toThrow(/unknown/i)
  })

  it("CHAT_STREAM_CHANNELS 覆盖全部受支持通道", () => {
    const all: ChatStreamChannel[] = [
      "chat-stream-start",
      "chat-stream-chunk",
      "chat-stream-done",
      "chat-stream-error",
      "chat-stream-tools",
      "chat-stream-approval",
      "chat-stream-patch",
    ]
    expect(CHAT_STREAM_CHANNELS).toEqual(all)
    // 每个通道都能被映射（不抛未知通道错）
    const start: ChatStreamStart = { sessionId: sess }
    for (const c of CHAT_STREAM_CHANNELS) {
      expect(() => buildEventFromChannel(c, c === "chat-stream-start" ? start : {})).not.toThrow(
        /unknown/i,
      )
    }
  })
})
