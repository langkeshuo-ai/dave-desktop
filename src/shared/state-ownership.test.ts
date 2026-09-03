/**
 * State ownership contract tests — 状态所有权规约单测
 *
 * 验证:
 * - 跨三域的所有权契约结构完整(无孤儿状态、无空写入入口)
 * - 写入入口合法性判定(isLegitWriteEntry)
 * - 已登记状态判定(isRegisteredState)
 */
import { describe, it, expect } from "vitest"
import {
  StateScope,
  STATE_OWNERSHIP,
  isLegitWriteEntry,
  isRegisteredState,
} from "./state-ownership"

describe("state ownership contract", () => {
  it("every contract declares a scope, authority and non-empty write entries", () => {
    for (const c of STATE_OWNERSHIP) {
      expect(c.scope).toBeDefined()
      expect(Object.values(StateScope)).toContain(c.scope)
      expect(c.authority).toMatch(/^(main|renderer):/)
      expect(c.writeEntries.length).toBeGreaterThan(0)
      expect(c.readSubChannel.length).toBeGreaterThan(0)
    }
  })

  it("field names are unique across contracts", () => {
    const names = STATE_OWNERSHIP.map((c) => c.field)
    expect(new Set(names).size).toBe(names.length)
  })

  it("isLegitWriteEntry matches declared entries", () => {
    expect(isLegitWriteEntry("currentSessionId", "session-create")).toBe(true)
    expect(isLegitWriteEntry("isStreaming", "chat-abort")).toBe(true)
    expect(isLegitWriteEntry("messages", "session-replace-messages")).toBe(true)
    // 未登记通道写入该字段 = 违反规约
    expect(isLegitWriteEntry("currentSessionId", "store-set")).toBe(false)
    // 跨域:渲染端直写 lifecycle 字段应被拒绝
    expect(isLegitWriteEntry("isStreaming", "store-set")).toBe(false)
  })

  it("isRegisteredState returns true only for registered fields", () => {
    expect(isRegisteredState("currentSessionId")).toBe(true)
    expect(isRegisteredState("pendingApproval")).toBe(true)
    expect(isRegisteredState("some-orphan-state")).toBe(false)
  })

  it("rendering session state stays in renderer scope, lifecycle in main", () => {
    const messages = STATE_OWNERSHIP.find((c) => c.field === "messages")
    const streaming = STATE_OWNERSHIP.find((c) => c.field === "isStreaming")
    expect(messages?.scope).toBe(StateScope.Session)
    expect(messages?.authority).toBe("renderer:useStore")
    expect(streaming?.scope).toBe(StateScope.Lifecycle)
    expect(streaming?.authority).toBe("main:session-runtime")
  })
})
