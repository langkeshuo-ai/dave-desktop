/**
 * Security Module Tests — 安全模块综合测试
 *
 * 覆盖 ipc-guard、tool-capability、rpc-hub 三个模块的核心行为。
 * 从 zcode-client 的 ipc-security.test.mjs / rpc.test.mjs 迁移，TypeScript + Vitest 重写。
 *
 * 运行：npx vitest run src/main/security/security.test.ts
 */
import { describe, it, expect, beforeEach } from "vitest"
import crypto from "node:crypto"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"

import {
  inspectValue,
  MAX_IPC_DEPTH,
  MAX_IPC_STRING,
  MAX_IPC_KEYS,
  BLOCKED_KEYS,
  assertAllowedShellPath,
  channelSchemas,
} from "./ipc-guard"
import {
  hashToolRequest,
  summarizeToolInput,
  createToolCapabilityAuthority,
  DEFAULT_TTL_MS,
  SENSITIVE_KEYS,
} from "./tool-capability"
import { RpcHub, RpcErrorCode, MAX_METHOD_LENGTH, MAX_BATCH_SIZE } from "./rpc-hub"

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
    let obj: Record<string, unknown> = {}
    let current = obj
    for (let i = 0; i <= MAX_IPC_DEPTH + 1; i++) {
      current.next = {}
      current = current.next as Record<string, unknown>
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
      obj[key] = "bad"
      expect(() => inspectValue(obj)).toThrow(`key is not allowed: ${key}`)
    }
  })
})

// ─── assertAllowedShellPath 测试 ─────────────────────────

describe("assertAllowedShellPath", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dave-sec-test-"))
  })

  it("accepts path within trusted roots", () => {
    const subDir = path.join(tmpDir, "sub")
    fs.mkdirSync(subDir)
    const result = assertAllowedShellPath(subDir, [tmpDir])
    expect(result).toBe(path.resolve(subDir))
  })

  it("rejects path outside trusted roots", () => {
    const outside = path.join(os.tmpdir(), "definitely-outside-dave")
    expect(() => assertAllowedShellPath(outside, [tmpDir])).toThrow("outside trusted roots")
  })

  it("rejects relative paths", () => {
    expect(() => assertAllowedShellPath("relative/path", [tmpDir])).toThrow("absolute local path required")
  })

  it("rejects paths with null bytes", () => {
    expect(() => assertAllowedShellPath(`${tmpDir}\0evil`, [tmpDir])).toThrow("absolute local path required")
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

// ─── RpcHub 测试 ─────────────────────────────────────────

describe("RpcHub", () => {
  let hub: RpcHub

  beforeEach(() => {
    hub = new RpcHub()
  })

  it("registers and calls a method", async () => {
    hub.method("echo", async (params) => params)
    const result = await hub.handleMessage({ jsonrpc: "2.0", id: 1, method: "echo", params: { hello: "world" } })
    expect(result).toEqual({ jsonrpc: "2.0", id: 1, result: { hello: "world" } })
  })

  it("returns MethodNotFound for unknown methods", async () => {
    const result = (await hub.handleMessage({ jsonrpc: "2.0", id: 2, method: "nonexistent" })) as Record<string, unknown>
    expect(result.error).toBeDefined()
    expect((result.error as Record<string, unknown>).code).toBe(RpcErrorCode.MethodNotFound)
  })

  it("rejects method names exceeding max length", async () => {
    const longMethod = "a".repeat(MAX_METHOD_LENGTH + 1)
    const result = (await hub.handleMessage({ jsonrpc: "2.0", id: 3, method: longMethod })) as Record<string, unknown>
    expect(result.error).toBeDefined()
    expect((result.error as Record<string, unknown>).code).toBe(RpcErrorCode.InvalidRequest)
  })

  it("handles batch requests", async () => {
    hub.method("add", async (params: unknown) => {
      const p = params as { a: number; b: number }
      return p.a + p.b
    })
    hub.method("mul", async (params: unknown) => {
      const p = params as { a: number; b: number }
      return p.a * p.b
    })
    const results = (await hub.handleMessage([
      { jsonrpc: "2.0", id: 1, method: "add", params: { a: 2, b: 3 } },
      { jsonrpc: "2.0", id: 2, method: "mul", params: { a: 4, b: 5 } },
    ])) as Record<string, unknown>[]
    expect(results).toHaveLength(2)
    expect(results[0].result).toBe(5)
    expect(results[1].result).toBe(20)
  })

  it("rejects empty batch", async () => {
    const result = await hub.handleMessage([])
    expect((result as Record<string, unknown>).error).toBeDefined()
  })

  it("rejects batch exceeding max size", async () => {
    const batch = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => ({
      jsonrpc: "2.0" as const,
      id: i,
      method: "test",
    }))
    const result = await hub.handleMessage(batch)
    expect((result as Record<string, unknown>).error).toBeDefined()
  })

  it("runs middleware in order", async () => {
    const calls: string[] = []
    hub.use(async ({ method, params, ctx }) => {
      calls.push("mw1")
      return { method, params: { ...(params as object), mw1: true }, ctx }
    })
    hub.use(async ({ method, params, ctx }) => {
      calls.push("mw2")
      return { method, params: { ...(params as object), mw2: true }, ctx }
    })
    hub.method("check", async (params) => params)
    const result = (await hub.handleMessage({ jsonrpc: "2.0", id: 1, method: "check", params: { original: true } })) as Record<string, unknown>
    expect(calls).toEqual(["mw1", "mw2"])
    expect(result.result).toEqual({ original: true, mw1: true, mw2: true })
  })

  it("listMethods returns sorted names", () => {
    hub.method("zeta", async () => {})
    hub.method("alpha", async () => {})
    hub.method("middle", async () => {})
    expect(hub.listMethods()).toEqual(["alpha", "middle", "zeta"])
  })

  it("rejects non-object messages", async () => {
    const result = await hub.handleMessage("not an object" as unknown as RpcMessage)
    expect((result as Record<string, unknown>).error).toBeDefined()
  })
})
