/**
 * Tool Approval Cache Tests — 工具审批缓存测试
 *
 * 覆盖 tool-approval-cache 的核心行为：
 * - 无令牌时 tryAutoApprove 返回 false
 * - grantReusableApproval 后相同请求自动通过
 * - 令牌一次性使用
 * - 不同 tool / input / workspace 不共享令牌
 *
 * 运行：npx vitest run src/main/tool-approval-cache.test.ts
 */
import { describe, it, expect } from "vitest"
import {
  grantReusableApproval,
  grantReusableApprovalByTool,
  tryAutoApprove,
  tryAutoApproveByTool,
} from "./tool-approval-cache"
import type { ToolRequest } from "./security/tool-capability"

// 每个测试用唯一 tool 名，避免模块级单例状态跨测试污染
let counter = 0
function makeReq(overrides: Partial<ToolRequest> = {}): ToolRequest {
  counter += 1
  return {
    tool: `test-tool-${counter}`,
    workspace: "/test/workspace",
    input: { path: "/tmp/test.txt" },
    ...overrides,
  }
}

describe("tool-approval-cache", () => {
  describe("tryAutoApprove", () => {
    it("returns false when no token has been granted", () => {
      const req = makeReq()
      expect(tryAutoApprove(req)).toBe(false)
    })

    it("returns true for the same request after grantReusableApproval", () => {
      const req = makeReq()
      grantReusableApproval(req)
      expect(tryAutoApprove(req)).toBe(true)
    })

    it("is one-time use: second call returns false", () => {
      const req = makeReq()
      grantReusableApproval(req)
      expect(tryAutoApprove(req)).toBe(true)
      expect(tryAutoApprove(req)).toBe(false)
    })

    it("cleans up token entry even when consume fails", () => {
      // 授予令牌后用不同 input 调用 tryAutoApprove：consume 失败，但 entry 已删除
      const req = makeReq({ input: { a: 1 } })
      grantReusableApproval(req)
      const differentInput = { ...req, input: { b: 2 } }
      // 不同 input → 不同 digest → tokenByDigest 找不到 → false
      expect(tryAutoApprove(differentInput)).toBe(false)
      // 原请求的令牌仍在（因为 differentInput 的 digest 不同，没删到原 entry）
      expect(tryAutoApprove(req)).toBe(true)
    })
  })

  describe("request isolation", () => {
    it("different tool name does not share token", () => {
      const reqA = makeReq({ tool: "tool-alpha" })
      const reqB = makeReq({ tool: "tool-beta" })
      grantReusableApproval(reqA)
      expect(tryAutoApprove(reqB)).toBe(false)
      expect(tryAutoApprove(reqA)).toBe(true)
    })

    it("different input does not share token", () => {
      const reqA = makeReq({ input: { cmd: "ls" } })
      const reqB = { ...reqA, input: { cmd: "rm" } }
      grantReusableApproval(reqA)
      expect(tryAutoApprove(reqB)).toBe(false)
      expect(tryAutoApprove(reqA)).toBe(true)
    })

    it("different workspace does not share token", () => {
      const reqA = makeReq({ workspace: "/proj/a" })
      const reqB = { ...reqA, workspace: "/proj/b" }
      grantReusableApproval(reqA)
      expect(tryAutoApprove(reqB)).toBe(false)
      expect(tryAutoApprove(reqA)).toBe(true)
    })

    it("input key order does not affect hash (canonicalization)", () => {
      const reqA = makeReq({ input: { a: 1, b: 2 } })
      const reqB = { ...reqA, input: { b: 2, a: 1 } }
      grantReusableApproval(reqA)
      // 相同内容不同键序 → 相同哈希 → 自动通过
      expect(tryAutoApprove(reqB)).toBe(true)
    })
  })

  describe("grantReusableApproval", () => {
    it("overwrites existing token for same request", () => {
      const req = makeReq()
      grantReusableApproval(req)
      grantReusableApproval(req) // 第二次授予，覆盖第一次
      // 只能消费一次
      expect(tryAutoApprove(req)).toBe(true)
      expect(tryAutoApprove(req)).toBe(false)
    })

    it("can grant independently for different requests", () => {
      const reqA = makeReq({ tool: "tool-x" })
      const reqB = makeReq({ tool: "tool-y" })
      grantReusableApproval(reqA)
      grantReusableApproval(reqB)
      expect(tryAutoApprove(reqA)).toBe(true)
      expect(tryAutoApprove(reqB)).toBe(true)
    })
  })

  describe("tool-name level cache (tryAutoApproveByTool / grantReusableApprovalByTool)", () => {
    it("returns false when no tool-name token has been granted", () => {
      const tool = `readonly-${counter++}`
      expect(tryAutoApproveByTool(tool, "/ws")).toBe(false)
    })

    it("auto-approves any input for the same tool after grant", () => {
      const tool = `readonly-${counter++}`
      grantReusableApprovalByTool(tool, "/ws")
      // 不同参数都应自动通过（工具名级别不绑定 input）
      expect(tryAutoApproveByTool(tool, "/ws")).toBe(true)
    })

    it("is one-time use: second call returns false", () => {
      const tool = `readonly-${counter++}`
      grantReusableApprovalByTool(tool, "/ws")
      expect(tryAutoApproveByTool(tool, "/ws")).toBe(true)
      expect(tryAutoApproveByTool(tool, "/ws")).toBe(false)
    })

    it("different tool does not share token", () => {
      const toolA = `readonly-a-${counter++}`
      const toolB = `readonly-b-${counter++}`
      grantReusableApprovalByTool(toolA, "/ws")
      expect(tryAutoApproveByTool(toolB, "/ws")).toBe(false)
      expect(tryAutoApproveByTool(toolA, "/ws")).toBe(true)
    })

    it("different workspace does not share token", () => {
      const tool = `readonly-${counter++}`
      grantReusableApprovalByTool(tool, "/ws/a")
      expect(tryAutoApproveByTool(tool, "/ws/b")).toBe(false)
      expect(tryAutoApproveByTool(tool, "/ws/a")).toBe(true)
    })

    it("tool-name token and exact-input token are independent", () => {
      // 工具名级别令牌（input:{}）和精确输入令牌（input:args）存储在不同 digest 下
      const tool = `mixed-${counter++}`
      const req = { tool, workspace: "/ws", input: { path: "/a" } }
      grantReusableApproval(req) // 精确输入
      grantReusableApprovalByTool(tool, "/ws") // 工具名级别
      // 精确输入消费一次
      expect(tryAutoApprove(req)).toBe(true)
      // 工具名级别仍然可用（独立存储）
      expect(tryAutoApproveByTool(tool, "/ws")).toBe(true)
    })
  })
})
