/**
 * Security Module Tests — 安全模块综合测试
 *
 * 覆盖 ipc-guard、tool-capability 两个模块的核心行为。
 * 从 zcode-client 的 ipc-security.test.mjs / rpc.test.mjs 迁移，TypeScript + Vitest 重写。
 * rpc-hub 模块已于 2026-08 删除（生产代码零引用，未接线的死模块）。
 *
 * 运行：npx vitest run src/main/security/security.test.ts
 */
import { describe, it, expect } from "vitest"
import path from "node:path"

import {
  inspectValue,
  MAX_IPC_DEPTH,
  MAX_IPC_STRING,
  MAX_IPC_KEYS,
  BLOCKED_KEYS,
  channelSchemas,
} from "./ipc-guard"
import {
  hashToolRequest,
  summarizeToolInput,
  createToolCapabilityAuthority,
  DEFAULT_TTL_MS,
  SENSITIVE_KEYS,
} from "./tool-capability"

// ─── inspectValue 测试 ───────────────────────────────────

describe("inspectValue", () => {
  it("accepts primitives", () => {
    expect(() => inspectValue(null)).not.toThrow()
    expect(() => inspectValue(undefined)).not.toThrow()
    expect(() => inspectValue(42)).not.toThrow()
    expect(() => inspectValue("hello")).not.toThrow()
    expect(() => inspectValue(true)).not.toThrow()
  })

  it("accepts plain objects and arrays", () => {
    expect(() => inspectValue({ a: 1, b: [1, 2, 3] })).not.toThrow()
    expect(() => inspectValue([{ nested: { deep: "ok" } }])).not.toThrow()
  })

  it("rejects objects exceeding max depth", () => {
    const obj: Record<string, unknown> = {}
    let current = obj
    for (let i = 0; i <= MAX_IPC_DEPTH + 1; i++) {
      current.next = {}
      current = current.next as unknown as Record<string, unknown>
    }
    expect(() => inspectValue(obj)).toThrow("maximum depth")
  })

  it("rejects strings exceeding max length", () => {
    const longStr = "a".repeat(MAX_IPC_STRING + 1)
    expect(() => inspectValue(longStr)).toThrow("maximum length")
  })

  it("rejects cyclic references", () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    expect(() => inspectValue(obj)).toThrow("cycles")
  })

  it("rejects arrays exceeding max length", () => {
    const bigArray = new Array(10_001).fill(1)
    expect(() => inspectValue(bigArray)).toThrow("maximum length")
  })

  it("rejects non-plain objects (class instances)", () => {
    class Foo {
      bar = 1
    }
    expect(() => inspectValue(new Foo())).toThrow("plain objects only")
  })

  it("rejects objects with too many keys", () => {
    const obj: Record<string, number> = {}
    for (let i = 0; i <= MAX_IPC_KEYS + 1; i++) {
      obj[`key${i}`] = i
    }
    expect(() => inspectValue(obj)).toThrow("too many keys")
  })

  it("rejects blocked keys", () => {
    for (const key of BLOCKED_KEYS) {
      const obj: Record<string, unknown> = {}
      Object.defineProperty(obj, key, {
        value: "bad",
        enumerable: true,
        writable: true,
        configurable: true,
      })
      expect(() => inspectValue(obj)).toThrow(`key is not allowed: ${key}`)
    }
  })
})

// ─── channelSchemas 测试 ─────────────────────────────────

describe("channelSchemas", () => {
  it("noArgs rejects any args", () => {
    expect(() => channelSchemas.noArgs.parse([])).not.toThrow()
    expect(() => channelSchemas.noArgs.parse(["extra"])).toThrow()
  })

  it("id requires non-empty string", () => {
    expect(() => channelSchemas.id.parse(["abc123"])).not.toThrow()
    expect(() => channelSchemas.id.parse([""])).toThrow()
    expect(() => channelSchemas.id.parse([123])).toThrow()
  })

  it("chatSend validates required fields", () => {
    const valid = [{ sessionId: "s1", text: "hello", providerId: "p1", modelId: "m1" }]
    expect(() => channelSchemas.chatSend.parse(valid)).not.toThrow()
    expect(() => channelSchemas.chatSend.parse([{ sessionId: "s1" }])).toThrow()
  })
})

// ─── hashToolRequest 测试 ────────────────────────────────

describe("hashToolRequest", () => {
  it("produces consistent SHA256 hex hash", () => {
    const req = { tool: "bash", workspace: "/proj", input: { cmd: "ls" } }
    const hash1 = hashToolRequest(req)
    const hash2 = hashToolRequest(req)
    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[a-f0-9]{64}$/)
  })

  it("different tools produce different hashes", () => {
    const h1 = hashToolRequest({ tool: "bash", workspace: "/p", input: {} })
    const h2 = hashToolRequest({ tool: "write", workspace: "/p", input: {} })
    expect(h1).not.toBe(h2)
  })

  it("input key order does not affect hash (canonicalization)", () => {
    const h1 = hashToolRequest({ tool: "t", workspace: "/p", input: { a: 1, b: 2 } })
    const h2 = hashToolRequest({ tool: "t", workspace: "/p", input: { b: 2, a: 1 } })
    expect(h1).toBe(h2)
  })

  it("resolves workspace to absolute path", () => {
    const h1 = hashToolRequest({ tool: "t", workspace: "/p", input: {} })
    const h2 = hashToolRequest({ tool: "t", workspace: path.resolve("/p"), input: {} })
    expect(h1).toBe(h2)
  })
})

// ─── summarizeToolInput 测试 ─────────────────────────────

describe("summarizeToolInput", () => {
  it("returns non-sensitive keys sorted", () => {
    const summary = summarizeToolInput({ zebra: 1, apple: 2, mango: 3 })
    expect(summary.keys).toEqual(["apple", "mango", "zebra"])
    expect(summary.redactedKeys).toBe(0)
  })

  it("redacts sensitive keys", () => {
    const summary = summarizeToolInput({ cmd: "ls", apiKey: "secret", authorization: "Bearer x" })
    expect(summary.keys).toContain("cmd")
    expect(summary.keys).not.toContain("apiKey")
    expect(summary.keys).not.toContain("authorization")
    expect(summary.redactedKeys).toBe(2)
  })

  it("matches SENSITIVE_KEYS regex for common patterns", () => {
    expect(SENSITIVE_KEYS.test("apiKey")).toBe(true)
    expect(SENSITIVE_KEYS.test("api_key")).toBe(true)
    expect(SENSITIVE_KEYS.test("API-KEY")).toBe(true)
    expect(SENSITIVE_KEYS.test("authorization")).toBe(true)
    expect(SENSITIVE_KEYS.test("token")).toBe(true)
    expect(SENSITIVE_KEYS.test("secret")).toBe(true)
    expect(SENSITIVE_KEYS.test("password")).toBe(true)
    expect(SENSITIVE_KEYS.test("cookie")).toBe(true)
    expect(SENSITIVE_KEYS.test("credential")).toBe(true)
    expect(SENSITIVE_KEYS.test("command")).toBe(false)
    expect(SENSITIVE_KEYS.test("path")).toBe(false)
  })
})

// ─── ToolCapabilityAuthority 测试 ────────────────────────

describe("createToolCapabilityAuthority", () => {
  it("issues and consumes a valid token", () => {
    const authority = createToolCapabilityAuthority()
    const req = { tool: "bash", workspace: "/p", input: { cmd: "ls" } }
    const token = authority.issue(req)
    expect(typeof token).toBe("string")
    expect(token).toContain(".")
    expect(authority.consume(token, req)).toBe(true)
  })

  it("rejects token replay (one-time use)", () => {
    const authority = createToolCapabilityAuthority()
    const req = { tool: "bash", workspace: "/p", input: { cmd: "ls" } }
    const token = authority.issue(req)
    expect(authority.consume(token, req)).toBe(true)
    expect(authority.consume(token, req)).toBe(false)
  })

  it("rejects token for different request (digest mismatch)", () => {
    const authority = createToolCapabilityAuthority()
    const token = authority.issue({ tool: "bash", workspace: "/p", input: { cmd: "ls" } })
    expect(authority.consume(token, { tool: "write", workspace: "/p", input: {} })).toBe(false)
  })

  it("rejects expired tokens", () => {
    let fakeTime = 1000
    const authority = createToolCapabilityAuthority({
      ttlMs: 100,
      now: () => fakeTime,
      randomUUID: () => "test-id",
    })
    const req = { tool: "bash", workspace: "/p", input: {} }
    const token = authority.issue(req)
    fakeTime = 1000 + 101 // expired
    expect(authority.consume(token, req)).toBe(false)
  })

  it("rejects malformed tokens", () => {
    const authority = createToolCapabilityAuthority()
    const req = { tool: "bash", workspace: "/p", input: {} }
    expect(authority.consume("not-a-token", req)).toBe(false)
    expect(authority.consume("a.b.c", req)).toBe(false)
    expect(authority.consume(123 as unknown as string, req)).toBe(false)
  })

  it("uses timing-safe comparison (different length signatures rejected)", () => {
    const authority = createToolCapabilityAuthority()
    const req = { tool: "bash", workspace: "/p", input: {} }
    const token = authority.issue(req)
    const [encoded] = token.split(".")
    // Tampered signature with different length
    expect(authority.consume(`${encoded}.short`, req)).toBe(false)
  })

  it("default TTL is 60 seconds", () => {
    expect(DEFAULT_TTL_MS).toBe(60_000)
  })
})
